import { AssetBalanceWithPrice } from '@rotki/common';
import { get, set } from '@vueuse/core';
import sortBy from 'lodash/sortBy';
import { createPinia, setActivePinia, storeToRefs } from 'pinia';
import { TRADE_LOCATION_BANKS } from '@/data/defaults';
import { BalanceType, BtcBalances } from '@/services/balances/types';
import { BtcAccountData } from '@/services/types-api';
import { useExchangeBalancesStore } from '@/store/balances/exchanges';
import { BalanceGetters, getters } from '@/store/balances/getters';
import { useManualBalancesStore } from '@/store/balances/manual';
import { useBalancePricesStore } from '@/store/balances/prices';
import { BalanceState } from '@/store/balances/types';
import store from '@/store/store';
import { RotkehlchenState } from '@/store/types';
import { SupportedExchange } from '@/types/exchanges';
import { bigNumberify, Zero } from '@/utils/bignumbers';
import { stub } from '../../../common/utils';

describe('balances:getters', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('aggregatedBalances', () => {
    const { connectedExchanges, exchangeBalances } = storeToRefs(
      useExchangeBalancesStore()
    );
    set(connectedExchanges, [
      {
        location: SupportedExchange.KRAKEN,
        name: 'Bitrex Acc'
      }
    ]);

    set(exchangeBalances, {
      [SupportedExchange.KRAKEN]: {
        DAI: {
          amount: bigNumberify(50),
          usdValue: bigNumberify(50)
        },
        BTC: {
          amount: bigNumberify(50),
          usdValue: bigNumberify(50)
        },
        ETH: {
          amount: bigNumberify(50),
          usdValue: bigNumberify(50)
        },
        EUR: {
          amount: bigNumberify(50),
          usdValue: bigNumberify(50)
        }
      }
    });

    const { prices } = storeToRefs(useBalancePricesStore());
    set(prices, {
      DAI: bigNumberify(1),
      EUR: bigNumberify(1),
      SAI: bigNumberify(1),
      ETH: bigNumberify(3000),
      BTC: bigNumberify(40000)
    });

    const mockGetters = {
      totals: [
        {
          asset: 'DAI',
          amount: bigNumberify(100),
          usdValue: bigNumberify(100)
        },
        {
          asset: 'BTC',
          amount: bigNumberify(100),
          usdValue: bigNumberify(100)
        },
        {
          asset: 'ETH',
          amount: bigNumberify(100),
          usdValue: bigNumberify(100)
        },
        {
          asset: 'SAI',
          amount: bigNumberify(100),
          usdValue: bigNumberify(100)
        }
      ]
    };

    const { manualBalancesData } = storeToRefs(useManualBalancesStore());
    set(manualBalancesData, [
      {
        id: 1,
        usdValue: bigNumberify(50),
        amount: bigNumberify(50),
        asset: 'DAI',
        label: '123',
        tags: [],
        location: TRADE_LOCATION_BANKS,
        balanceType: BalanceType.ASSET
      }
    ]);
    const state: BalanceState = stub<BalanceState>({});

    const actualResult = sortBy(
      getters.aggregatedBalances(
        state,
        stub<BalanceGetters>(mockGetters),
        stub<RotkehlchenState>(),
        stub()
      ),
      'asset'
    );

    const expectedResult = sortBy(
      [
        {
          asset: 'EUR',
          amount: bigNumberify(50),
          usdValue: bigNumberify(50),
          usdPrice: bigNumberify(1)
        },
        {
          asset: 'DAI',
          amount: bigNumberify(200),
          usdValue: bigNumberify(200),
          usdPrice: bigNumberify(1)
        },
        {
          asset: 'BTC',
          amount: bigNumberify(150),
          usdValue: bigNumberify(150),
          usdPrice: bigNumberify(40000)
        },
        {
          asset: 'ETH',
          amount: bigNumberify(150),
          usdValue: bigNumberify(150),
          usdPrice: bigNumberify(3000)
        },
        {
          asset: 'SAI',
          amount: bigNumberify(100),
          usdValue: bigNumberify(100),
          usdPrice: bigNumberify(1)
        }
      ] as AssetBalanceWithPrice[],
      'asset'
    );

    expect(actualResult).toMatchObject(expectedResult);
  });

  test('manualLabels', () => {
    const { manualBalancesData, manualLabels } = storeToRefs(
      useManualBalancesStore()
    );
    set(manualBalancesData, [
      {
        id: 1,
        usdValue: bigNumberify(50),
        amount: bigNumberify(50),
        asset: 'DAI',
        label: 'My monero wallet',
        tags: [],
        location: TRADE_LOCATION_BANKS,
        balanceType: BalanceType.ASSET
      },
      {
        id: 2,
        usdValue: bigNumberify(50),
        amount: bigNumberify(50),
        asset: 'EUR',
        label: 'My Bank Account',
        tags: [],
        location: TRADE_LOCATION_BANKS,
        balanceType: BalanceType.ASSET
      }
    ]);
    expect(
      // @ts-ignore
      get(manualLabels)
    ).toMatchObject(['My monero wallet', 'My Bank Account']);
  });

  test('btcAccounts', () => {
    const accounts: BtcAccountData = {
      standalone: [
        {
          address: '123',
          tags: null,
          label: null
        }
      ],
      xpubs: [
        {
          xpub: 'xpub123',
          addresses: [
            {
              address: '1234',
              tags: null,
              label: null
            }
          ],
          tags: null,
          label: null,
          derivationPath: 'm'
        },
        {
          xpub: 'xpub1234',
          derivationPath: null,
          label: '123',
          tags: ['a'],
          addresses: null
        }
      ]
    };
    const balances: BtcBalances = {
      standalone: {
        '123': { usdValue: bigNumberify(10), amount: bigNumberify(10) }
      },
      xpubs: [
        {
          xpub: 'xpub123',
          derivationPath: 'm',
          addresses: {
            '1234': { usdValue: bigNumberify(10), amount: bigNumberify(10) }
          }
        }
      ]
    };
    store.commit('balances/btcAccounts', accounts);
    store.commit('balances/updateBtc', balances);

    const btcAccounts = getters.btcAccounts(
      store.state.balances!!,
      getters as any as BalanceGetters,
      stub<RotkehlchenState>(),
      null
    );

    expect(btcAccounts).toEqual([
      {
        address: '123',
        balance: {
          amount: bigNumberify(10),
          usdValue: bigNumberify(10)
        },
        chain: 'BTC',
        label: '',
        tags: []
      },
      {
        address: '',
        balance: {
          amount: Zero,
          usdValue: Zero
        },
        chain: 'BTC',
        derivationPath: 'm',
        label: '',
        tags: [],
        xpub: 'xpub123'
      },
      {
        address: '1234',
        balance: {
          amount: bigNumberify(10),
          usdValue: bigNumberify(10)
        },
        chain: 'BTC',
        derivationPath: 'm',
        label: '',
        tags: [],
        xpub: 'xpub123'
      },
      {
        address: '',
        balance: {
          amount: Zero,
          usdValue: Zero
        },
        chain: 'BTC',
        derivationPath: '',
        label: '123',
        tags: ['a'],
        xpub: 'xpub1234'
      }
    ]);
  });
});
