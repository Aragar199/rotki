import { AssetBalance, AssetBalanceWithPrice, BigNumber } from '@rotki/common';
import { GeneralAccount } from '@rotki/common/lib/account';
import { Blockchain } from '@rotki/common/lib/blockchain';
import { computed, Ref } from '@vue/composition-api';
import { get } from '@vueuse/core';
import { tradeLocations } from '@/components/history/consts';
import { Routes } from '@/router/routes';
import { api } from '@/services/rotkehlchen-api';
import { useAssetInfoRetrieval } from '@/store/assets';
import {
  AddAccountsPayload,
  AllBalancePayload,
  AssetBreakdown,
  BalanceByLocation,
  BasicBlockchainAccountPayload,
  BlockchainAccountPayload,
  BlockchainAccountWithBalance,
  BlockchainBalancePayload,
  BlockchainTotal,
  FetchPricePayload,
  NonFungibleBalance,
  XpubPayload
} from '@/store/balances/types';
import { useStore } from '@/store/utils';
import { Eth2Validator } from '@/types/balances';
import { assert } from '@/utils/assertions';

export const setupGeneralBalances = () => {
  const store = useStore();

  const aggregatedBalances = computed<AssetBalanceWithPrice[]>(() => {
    return store.getters['balances/aggregatedBalances'];
  });

  const balancesByLocation = computed<BalanceByLocation>(() => {
    return store.getters['balances/byLocation'];
  });

  const liabilities = computed<AssetBalance[]>(() => {
    return store.getters['balances/liabilities'];
  });

  const blockchainTotals = computed<BlockchainTotal[]>(() => {
    return store.getters['balances/blockchainTotals'];
  });

  const hasDetails = (account: string) =>
    computed<boolean>(() => {
      return store.getters['balances/hasDetails'](account);
    });

  const accountAssets = (account: string) =>
    computed<AssetBalance[]>(() => {
      return store.getters['balances/accountAssets'](account);
    });

  const accountLiabilities = (account: string) =>
    computed<AssetBalance[]>(() => {
      return store.getters['balances/accountLiabilities'](account);
    });

  const loopringBalances = (account: string) =>
    computed<AssetBalance[]>(() => {
      return store.getters['balances/loopringBalances'](account);
    });

  const assetBreakdown = (asset: string) =>
    computed<AssetBreakdown[]>(() => {
      return store.getters['balances/assetBreakdown'](asset);
    });

  const fetchBalances: (
    payload: Partial<AllBalancePayload>
  ) => Promise<void> = async payload => {
    return await store.dispatch('balances/fetchBalances', payload);
  };

  const fetchBlockchainBalances: (
    payload: BlockchainBalancePayload
  ) => Promise<void> = async payload => {
    return await store.dispatch('balances/fetchBlockchainBalances', payload);
  };

  const fetchLoopringBalances: (
    refresh: boolean
  ) => Promise<void> = async refresh => {
    return await store.dispatch('balances/fetchLoopringBalances', refresh);
  };

  const refreshPrices: (
    payload: FetchPricePayload
  ) => Promise<void> = async payload => {
    return await store.dispatch('balances/refreshPrices', payload);
  };

  const isEthereumToken = (asset: string) => {
    return computed<boolean>(() =>
      store.getters['balances/isEthereumToken'](asset)
    );
  };

  const fetchTokenDetails = async (address: string) => {
    return await store.dispatch('balances/fetchTokenDetails', address);
  };

  const nfBalances = computed<NonFungibleBalance[]>(() => {
    return store.getters['balances/nfBalances'];
  });

  const nfTotalValue = (includeLPToken: boolean = false) =>
    computed<BigNumber>(() => {
      return store.getters['balances/nfTotalValue'](includeLPToken);
    });

  return {
    aggregatedBalances,
    balancesByLocation,
    liabilities,
    blockchainTotals,
    nfBalances,
    nfTotalValue,
    hasDetails,
    accountAssets,
    accountLiabilities,
    loopringBalances,
    assetBreakdown,
    fetchBalances,
    isEthereumToken,
    fetchTokenDetails,
    fetchBlockchainBalances,
    fetchLoopringBalances,
    refreshPrices
  };
};

export type BlockchainData = {
  btcAccounts: Ref<BlockchainAccountWithBalance[]>;
  bchAccounts: Ref<BlockchainAccountWithBalance[]>;
  polkadotBalances: Ref<BlockchainAccountWithBalance[]>;
  blockchainAssets: Ref<AssetBalanceWithPrice[]>;
  ethAccounts: Ref<BlockchainAccountWithBalance[]>;
  eth2Balances: Ref<BlockchainAccountWithBalance[]>;
  avaxAccounts: Ref<BlockchainAccountWithBalance[]>;
  kusamaBalances: Ref<BlockchainAccountWithBalance[]>;
  loopringAccounts: Ref<BlockchainAccountWithBalance[]>;
};

export const setupBlockchainData = (): BlockchainData => {
  const store = useStore();

  const ethAccounts = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/ethAccounts']
  );
  const eth2Balances = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/eth2Balances']
  );
  const btcAccounts = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/btcAccounts']
  );
  const bchAccounts = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/bchAccounts']
  );
  const blockchainAssets = computed<AssetBalanceWithPrice[]>(
    () => store.getters['balances/blockchainAssets']
  );
  const kusamaBalances = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/kusamaBalances']
  );
  const polkadotBalances = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/polkadotBalances']
  );
  const avaxAccounts = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/avaxAccounts']
  );
  const loopringAccounts = computed<BlockchainAccountWithBalance[]>(
    () => store.getters['balances/loopringAccounts']
  );

  return {
    ethAccounts,
    eth2Balances,
    btcAccounts,
    bchAccounts,
    blockchainAssets,
    kusamaBalances,
    polkadotBalances,
    avaxAccounts,
    loopringAccounts
  };
};

export const setupLocationInfo = () => {
  const isSupportedBlockchain = (identifier: string): boolean => {
    return Object.values(Blockchain).includes(identifier as any);
  };

  const getLocation = (identifier: string) => {
    const { assetName } = useAssetInfoRetrieval();

    if (isSupportedBlockchain(identifier)) {
      return {
        name: get(assetName(identifier)),
        identifier: identifier,
        exchange: false,
        imageIcon: true,
        icon: `${api.serverUrl}/api/1/assets/${identifier}/icon`,
        detailPath: `${Routes.ACCOUNTS_BALANCES_BLOCKCHAIN.route}#blockchain-balances-${identifier}`
      };
    }

    const locationFound = tradeLocations.find(
      location => location.identifier === identifier
    );
    assert(!!locationFound, 'location should not be falsy');
    return locationFound;
  };

  return {
    getLocation
  };
};

export const setupBlockchainAccounts = () => {
  const store = useStore();

  const account = (address: string) =>
    computed<GeneralAccount | undefined>(() =>
      store.getters['balances/account'](address)
    );

  const eth2Account = (address: string) =>
    computed<GeneralAccount | undefined>(() =>
      store.getters['balances/eth2Account'](address)
    );

  const accounts = computed<GeneralAccount[]>(
    () => store.getters['balances/accounts']
  );

  const addAccount = async (payload: BlockchainAccountPayload) => {
    return await store.dispatch('balances/addAccount', payload);
  };

  const removeAccount = async (payload: BasicBlockchainAccountPayload) => {
    return await store.dispatch('balances/removeAccount', payload);
  };

  const editAccount = async (payload: BlockchainAccountPayload) => {
    return await store.dispatch('balances/editAccount', payload);
  };

  const addAccounts = async (payload: AddAccountsPayload) => {
    return await store.dispatch('balances/addAccounts', payload);
  };

  const eth2Validators = computed(
    () => store.state.balances?.eth2Validators.entries
  );

  const addEth2Validator = async (payload: Eth2Validator) => {
    return await store.dispatch('balances/addEth2Validator', payload);
  };

  const editEth2Validator = async (payload: Eth2Validator) => {
    return await store.dispatch('balances/editEth2Validator', payload);
  };

  const deleteEth2Validators = async (payload: string[]) => {
    return await store.dispatch('balances/deleteEth2Validators', payload);
  };

  const deleteXpub = async (payload: XpubPayload) => {
    return await store.dispatch('balances/deleteXpub', payload);
  };

  return {
    account,
    eth2Account,
    accounts,
    addAccount,
    editAccount,
    addAccounts,
    eth2Validators,
    removeAccount,
    addEth2Validator,
    editEth2Validator,
    deleteEth2Validators,
    deleteXpub
  };
};
