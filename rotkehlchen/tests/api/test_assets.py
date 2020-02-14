from http import HTTPStatus

import pytest
import requests

from rotkehlchen.tests.utils.api import api_url_for, assert_error_response, assert_proper_response
from rotkehlchen.tests.utils.constants import A_RDN
from rotkehlchen.tests.utils.factories import UNIT_BTC_ADDRESS1, UNIT_BTC_ADDRESS2
from rotkehlchen.tests.utils.rotkehlchen import setup_balances


@pytest.mark.parametrize('number_of_eth_accounts', [2])
@pytest.mark.parametrize('btc_accounts', [[UNIT_BTC_ADDRESS1, UNIT_BTC_ADDRESS2]])
@pytest.mark.parametrize('owned_eth_tokens', [[A_RDN]])
@pytest.mark.parametrize('added_exchanges', [('binance', 'poloniex')])
def test_query_owned_assets(
        rotkehlchen_api_server_with_exchanges,
        ethereum_accounts,
        btc_accounts,
        number_of_eth_accounts,
):
    """Test that using the query all owned assets endpoint works"""
    # Disable caching of query results
    rotki = rotkehlchen_api_server_with_exchanges.rest_api.rotkehlchen
    rotki.chain_manager.cache_ttl_secs = 0
    setup = setup_balances(rotki, ethereum_accounts, btc_accounts)

    # Get all our mocked balances and save them in the DB
    with setup.poloniex_patch, setup.binance_patch, setup.etherscan_patch, setup.bitcoin_patch:
        response = requests.get(
            api_url_for(
                rotkehlchen_api_server_with_exchanges,
                "allbalancesresource",
            ), json={'save_data': True},
        )
    assert_proper_response(response)

    # And now check that the query owned assets endpoint works
    with setup.poloniex_patch, setup.binance_patch, setup.etherscan_patch, setup.bitcoin_patch:
        response = requests.get(
            api_url_for(
                rotkehlchen_api_server_with_exchanges,
                "ownedassetsresource",
            ),
        )
    assert_proper_response(response)
    data = response.json()
    assert data['message'] == ''
    assert set(data['result']) == {'ETH', 'BTC', 'EUR', 'RDN'}


def test_ignored_assets_modification(rotkehlchen_api_server_with_exchanges):
    """Test that using the ignored assets endpoint to modify the ignored assets list works fine"""
    rotki = rotkehlchen_api_server_with_exchanges.rest_api.rotkehlchen

    # add three assets to ignored assets
    ignored_assets = ['GNO', 'RDN', 'XMR']
    response = requests.put(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': ignored_assets},
    )
    assert_proper_response(response)
    data = response.json()
    assert data['message'] == ''
    assert data['result'] == ignored_assets

    # check they are there
    assert rotki.data.db.get_ignored_assets() == ignored_assets
    # Query for ignored assets and check that the response returns them
    response = requests.get(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ),
    )
    assert_proper_response(response)
    data = response.json()
    assert data['message'] == ''
    assert data['result'] == ignored_assets

    # remove two assets from ignored assets
    response = requests.delete(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': ['GNO', 'XMR']},
    )
    assets_after_deletion = ['RDN']
    assert_proper_response(response)
    data = response.json()
    assert data['message'] == ''
    assert data['result'] == assets_after_deletion

    # check that the changes are reflected
    assert rotki.data.db.get_ignored_assets() == assets_after_deletion
    # Query for ignored assets and check that the response returns them
    response = requests.get(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ),
    )
    assert_proper_response(response)
    data = response.json()
    assert data['message'] == ''
    assert data['result'] == assets_after_deletion


@pytest.mark.parametrize('method', ['put', 'delete'])
def test_ignored_assets_endpoint_errors(rotkehlchen_api_server_with_exchanges, method):
    """Test errors are handled properly at the ignored assets endpoint"""
    rotki = rotkehlchen_api_server_with_exchanges.rest_api.rotkehlchen

    # add three assets to ignored assets
    ignored_assets = ['GNO', 'RDN', 'XMR']
    response = requests.put(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': ignored_assets},
    )
    assert_proper_response(response)

    # Test that omitting the assets argument is an error
    response = getattr(requests, method)(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ),
    )
    assert_error_response(
        response=response,
        contained_in_msg="'assets': ['Missing data for required field",
        status_code=HTTPStatus.BAD_REQUEST,
    )

    # Test that invalid type for assets list is an error
    response = getattr(requests, method)(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': 'foo'},
    )
    assert_error_response(
        response=response,
        contained_in_msg='Unknown asset foo provided',
        status_code=HTTPStatus.BAD_REQUEST,
    )

    # Test that list with invalid asset is an error
    response = getattr(requests, method)(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': ['notanasset']},
    )
    assert_error_response(
        response=response,
        contained_in_msg='Unknown asset notanasset provided',
        status_code=HTTPStatus.BAD_REQUEST,
    )

    # Test that list with one valid and one invalid is rejected and not even the
    # valid one is processed
    if method == 'put':
        asset = 'ETH'
    else:
        asset = 'XMR'
    response = getattr(requests, method)(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': [asset, 'notanasset']},
    )
    assert_error_response(
        response=response,
        contained_in_msg='Unknown asset notanasset provided',
        status_code=HTTPStatus.BAD_REQUEST,
    )
    # Check that assets did not get modified
    assert rotki.data.db.get_ignored_assets() == ignored_assets

    # Test the adding an already existing asset or removing a non-existing asset is an error
    if method == 'put':
        asset = 'RDN'
        expected_msg = 'RDN is already in ignored assets'
    else:
        asset = 'ETH'
        expected_msg = 'ETH is not in ignored assets'
    response = getattr(requests, method)(
        api_url_for(
            rotkehlchen_api_server_with_exchanges,
            "ignoredassetsresource",
        ), json={'assets': [asset]},
    )
    assert_error_response(
        response=response,
        contained_in_msg=expected_msg,
        status_code=HTTPStatus.CONFLICT,
    )
    # Check that assets did not get modified
    assert rotki.data.db.get_ignored_assets() == ignored_assets
