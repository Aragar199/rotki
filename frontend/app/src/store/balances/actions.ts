import { Blockchain } from '@rotki/common/lib/blockchain';
import { Message, Severity } from '@rotki/common/lib/messages';
import { Eth2Validators } from '@rotki/common/lib/staking/eth2';
import { get, set } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { ActionTree } from 'vuex';
import i18n from '@/i18n';
import { BlockchainBalances, BtcBalances } from '@/services/balances/types';
import { balanceKeys } from '@/services/consts';
import { api } from '@/services/rotkehlchen-api';
import {
  BtcAccountData,
  GeneralAccountData,
  XpubAccountData
} from '@/services/types-api';
import { BalanceActions } from '@/store/balances/action-types';
import { chainSection } from '@/store/balances/const';
import { useEthNamesStore } from '@/store/balances/ethereum-names';
import { useExchangeBalancesStore } from '@/store/balances/exchanges';
import { useManualBalancesStore } from '@/store/balances/manual';
import { BalanceMutations } from '@/store/balances/mutation-types';
import { useBalancePricesStore } from '@/store/balances/prices';
import {
  AccountAssetBalances,
  AccountPayload,
  AddAccountsPayload,
  AllBalancePayload,
  BalanceState,
  BasicBlockchainAccountPayload,
  BlockchainAccountPayload,
  BlockchainBalancePayload,
  ERC20Token,
  FetchPricePayload,
  NonFungibleBalances,
  XpubPayload
} from '@/store/balances/types';
import { Section, Status } from '@/store/const';
import { useDefiStore } from '@/store/defi';
import { useUniswapStore } from '@/store/defi/uniswap';
import { useMainStore } from '@/store/main';
import { useNotifications } from '@/store/notifications';
import { usePremiumStore } from '@/store/session/premium';
import { useSettingsStore } from '@/store/settings';
import { useFrontendSettingsStore } from '@/store/settings/frontend';
import { useGeneralSettingsStore } from '@/store/settings/general';
import { useTasks } from '@/store/tasks';
import { RotkehlchenState } from '@/store/types';
import {
  getStatus,
  getStatusUpdater,
  isLoading,
  setStatus
} from '@/store/utils';
import { Eth2Validator } from '@/types/balances';
import { Exchange, ExchangeData } from '@/types/exchanges';
import { Module } from '@/types/modules';
import { BlockchainMetadata, TaskMeta } from '@/types/task';
import { TaskType } from '@/types/task-type';
import { assert } from '@/utils/assertions';
import { logger } from '@/utils/logging';

function removeTag(tags: string[] | null, tagName: string): string[] | null {
  if (!tags) {
    return null;
  }

  const index = tags.indexOf(tagName);

  if (index < 0) {
    return null;
  }

  return [...tags.slice(0, index), ...tags.slice(index + 1)];
}

function removeTags<T extends { tags: string[] | null }>(
  data: T[],
  tagName: string
): T[] {
  const accounts = [...data];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const tags = removeTag(account.tags, tagName);

    if (!tags) {
      continue;
    }

    accounts[i] = {
      ...accounts[i],
      tags
    };
  }
  return accounts;
}

export const actions: ActionTree<BalanceState, RotkehlchenState> = {
  async fetchBalances({ dispatch }, payload: Partial<AllBalancePayload> = {}) {
    const { addTask, isTaskRunning } = useTasks();
    if (get(isTaskRunning(TaskType.QUERY_BALANCES))) {
      return;
    }
    try {
      const { taskId } = await api.queryBalancesAsync(payload);
      await addTask(taskId, TaskType.QUERY_BALANCES, {
        title: i18n.t('actions.balances.all_balances.task.title').toString(),
        ignoreResult: true
      });
    } catch (e: any) {
      const { notify } = useNotifications();
      notify({
        title: i18n.t('actions.balances.all_balances.error.title').toString(),
        message: i18n
          .t('actions.balances.all_balances.error.message', {
            message: e.message
          })
          .toString(),
        display: true
      });
    }
    await dispatch('accounts');
  },

  async fetchBlockchainBalances(
    { dispatch },
    payload: BlockchainBalancePayload = {
      ignoreCache: false
    }
  ): Promise<void> {
    const { awaitTask } = useTasks();
    const { blockchain, ignoreCache } = payload;

    const chains: Blockchain[] = [];
    if (!blockchain) {
      chains.push(...Object.values(Blockchain));
    } else {
      chains.push(blockchain);
    }

    const fetch: (chain: Blockchain) => Promise<void> = async (
      chain: Blockchain
    ) => {
      const section = chainSection[chain];
      const currentStatus = getStatus(section);

      if (isLoading(currentStatus)) {
        return;
      }

      const newStatus =
        currentStatus === Status.LOADED ? Status.REFRESHING : Status.LOADING;
      setStatus(newStatus, section);

      const { taskId } = await api.balances.queryBlockchainBalances(
        ignoreCache,
        chain
      );
      const taskType = TaskType.QUERY_BLOCKCHAIN_BALANCES;
      const { result } = await awaitTask<
        BlockchainBalances,
        BlockchainMetadata
      >(
        taskId,
        taskType,
        {
          chain,
          title: `Query ${chain} Balances`,
          numericKeys: []
        } as BlockchainMetadata,
        true
      );
      const balances = BlockchainBalances.parse(result);
      await dispatch('updateBalances', {
        chain,
        balances,
        ignoreCache
      });
      setStatus(Status.LOADED, section);
    };
    try {
      await Promise.all(chains.map(fetch));
    } catch (e: any) {
      logger.error(e);
      const message = i18n.tc(
        'actions.balances.blockchain.error.description',
        0,
        {
          error: e.message
        }
      );
      const { notify } = useNotifications();
      notify({
        title: i18n.tc('actions.balances.blockchain.error.title'),
        message,
        display: true
      });
    }
  },

  async fetch({ dispatch }, exchanges: Exchange[]): Promise<void> {
    const { fetchExchangeRates } = useBalancePricesStore();
    await fetchExchangeRates();
    await dispatch('fetchBalances');

    if (exchanges && exchanges.length > 0) {
      const { setExchanges } = useExchangeBalancesStore();
      await setExchanges(exchanges);
    }
    await dispatch('fetchBlockchainBalances');
    await dispatch(BalanceActions.FETCH_NF_BALANCES);

    const { fetchV3Balances } = useUniswapStore();
    await fetchV3Balances();
  },

  async updateBalances(
    { commit, dispatch },
    payload: {
      chain?: Blockchain;
      balances: BlockchainBalances;
      ignoreCache?: boolean;
    }
  ): Promise<void> {
    const { perAccount, totals } = payload.balances;
    const {
      ETH: ethBalances,
      ETH2: eth2Balances,
      BTC: btcBalances,
      BCH: bchBalances,
      KSM: ksmBalances,
      DOT: dotBalances,
      AVAX: avaxBalances
    } = perAccount;
    const chain = payload.chain;
    const forceUpdate = payload.ignoreCache;

    if (forceUpdate && ethBalances) {
      const addresses = [...Object.keys(ethBalances)];

      const { fetchEnsNames } = useEthNamesStore();
      fetchEnsNames(addresses, forceUpdate);
    }

    if (!chain || chain === Blockchain.ETH) {
      commit('updateEth', ethBalances ?? {});
    }

    if (!chain || chain === Blockchain.KSM) {
      commit('updateKsm', ksmBalances ?? {});
    }

    if (!chain || chain === Blockchain.DOT) {
      commit('updateDot', dotBalances ?? {});
    }

    if (!chain || chain === Blockchain.BTC) {
      commit('updateBtc', btcBalances ?? {});
    }

    if (!chain || chain === Blockchain.BCH) {
      commit('updateBch', bchBalances ?? {});
    }

    if (!chain || chain === Blockchain.AVAX) {
      commit('updateAvax', avaxBalances ?? {});
    }

    if (!chain || chain === Blockchain.ETH2) {
      commit('updateEth2', eth2Balances ?? {});
    }

    commit('updateTotals', totals.assets);
    commit('updateLiabilities', totals.liabilities);
    const blockchainToRefresh = chain ? [chain] : null;
    dispatch('accounts', blockchainToRefresh).then();
  },

  async deleteXpub({ dispatch }, payload: XpubPayload) {
    const { awaitTask, isTaskRunning } = useTasks();
    try {
      const taskType = TaskType.REMOVE_ACCOUNT;
      if (get(isTaskRunning(taskType))) {
        return;
      }
      const { taskId } = await api.deleteXpub(payload);
      const { result } = await awaitTask<
        BlockchainBalances,
        BlockchainMetadata
      >(taskId, taskType, {
        title: i18n.tc('actions.balances.xpub_removal.task.title'),
        description: i18n.tc(
          'actions.balances.xpub_removal.task.description',
          0,
          {
            xpub: payload.xpub
          }
        ),
        blockchain: payload.blockchain,
        numericKeys: []
      } as BlockchainMetadata);
      const balances = BlockchainBalances.parse(result);
      await dispatch('updateBalances', {
        chain: payload.blockchain,
        balances
      });
    } catch (e: any) {
      logger.error(e);
      const title = i18n.tc('actions.balances.xpub_removal.error.title');
      const description = i18n.tc(
        'actions.balances.xpub_removal.error.description',
        0,
        {
          xpub: payload.xpub,
          error: e.message
        }
      );
      const { notify } = useNotifications();
      notify({
        title,
        message: description,
        display: true
      });
    }
  },

  async removeAccount({ dispatch }, payload: BasicBlockchainAccountPayload) {
    const { accounts, blockchain } = payload;
    assert(accounts, 'Accounts was empty');
    const { taskId } = await api.removeBlockchainAccount(blockchain, accounts);
    const { awaitTask } = useTasks();
    try {
      const taskType = TaskType.REMOVE_ACCOUNT;
      const { result } = await awaitTask<
        BlockchainBalances,
        BlockchainMetadata
      >(taskId, taskType, {
        title: i18n.tc(
          'actions.balances.blockchain_account_removal.task.title',
          0,
          {
            blockchain
          }
        ),
        description: i18n.tc(
          'actions.balances.blockchain_account_removal.task.description',
          0,
          { count: accounts.length }
        ),
        blockchain,
        numericKeys: []
      } as BlockchainMetadata);

      const balances = BlockchainBalances.parse(result);

      useDefiStore().reset();
      useMainStore().resetDefiStatus();

      dispatch(BalanceActions.FETCH_NF_BALANCES);

      if (blockchain === Blockchain.ETH) {
        const { fetchV3Balances } = useUniswapStore();
        fetchV3Balances();
      }

      await dispatch('updateBalances', { chain: blockchain, balances });
      await dispatch('refreshPrices', { ignoreCache: false });
    } catch (e: any) {
      logger.error(e);
      const title = i18n.tc(
        'actions.balances.blockchain_account_removal.error.title',
        0,
        { count: accounts.length, blockchain }
      );
      const description = i18n.tc(
        'actions.balances.blockchain_account_removal.error.description',
        0,
        {
          error: e.message
        }
      );
      const { notify } = useNotifications();
      notify({
        title,
        message: description,
        display: true
      });
    }
  },

  async addAccounts(
    { state, dispatch },
    { blockchain, payload, modules }: AddAccountsPayload
  ): Promise<void> {
    const { awaitTask, isTaskRunning } = useTasks();
    const taskType = TaskType.ADD_ACCOUNT;
    if (get(isTaskRunning(taskType))) {
      return;
    }

    let existingAccounts: GeneralAccountData[];
    if (blockchain === Blockchain.ETH) {
      existingAccounts = state.ethAccounts;
    } else if (blockchain === Blockchain.AVAX) {
      existingAccounts = state.avaxAccounts;
    } else if (blockchain === Blockchain.DOT) {
      existingAccounts = state.dotAccounts;
    } else if (blockchain === Blockchain.KSM) {
      existingAccounts = state.ksmAccounts;
    } else {
      throw new Error(
        `this chain ${blockchain} doesn't support multiple address addition`
      );
    }
    const existingAddresses = existingAccounts.map(address =>
      address.address.toLocaleLowerCase()
    );
    const accounts = payload.filter(
      value => !existingAddresses.includes(value.address.toLocaleLowerCase())
    );

    if (accounts.length === 0) {
      const title = i18n.tc(
        'actions.balances.blockchain_accounts_add.no_new.title',
        0,
        { blockchain }
      );
      const description = i18n.tc(
        'actions.balances.blockchain_accounts_add.no_new.description'
      );
      const { notify } = useNotifications();
      notify({
        title,
        message: description,
        severity: Severity.INFO,
        display: true
      });
      return;
    }

    const addAccount = async (
      blockchain: Blockchain,
      { address, label, tags }: AccountPayload,
      modules?: Module[]
    ) => {
      try {
        const { taskId } = await api.addBlockchainAccount({
          blockchain,
          address,
          label,
          tags
        });

        const { result } = await awaitTask<
          BlockchainBalances,
          BlockchainMetadata
        >(
          taskId,
          taskType,
          {
            title: i18n.tc(
              'actions.balances.blockchain_accounts_add.task.title',
              0,
              { blockchain }
            ),
            description: i18n.tc(
              'actions.balances.blockchain_accounts_add.task.description',
              0,
              { address }
            ),
            blockchain,
            numericKeys: []
          } as BlockchainMetadata,
          true
        );

        if (modules && blockchain === Blockchain.ETH) {
          const { enableModule } = useSettingsStore();
          await enableModule({
            enable: modules,
            addresses: [address]
          });
        }

        const balances = BlockchainBalances.parse(result);

        await dispatch('updateBalances', { chain: blockchain, balances });
      } catch (e) {
        logger.error(e);
      }
    };

    const requests = accounts.map(value =>
      addAccount(blockchain, value, modules)
    );

    try {
      await Promise.allSettled(requests);
      useDefiStore().reset();
      useMainStore().resetDefiStatus();
      dispatch(BalanceActions.FETCH_NF_BALANCES);

      if (blockchain === Blockchain.ETH) {
        await dispatch('fetchBlockchainBalances', {
          blockchain: Blockchain.ETH2
        });

        const { fetchV3Balances } = useUniswapStore();
        fetchV3Balances();
      }
      await dispatch('refreshPrices', { ignoreCache: false });
    } catch (e: any) {
      logger.error(e);
      const title = i18n.tc(
        'actions.balances.blockchain_accounts_add.error.title',
        0,
        { blockchain }
      );
      const description = i18n.tc(
        'actions.balances.blockchain_accounts_add.error.description',
        0,
        {
          error: e.message,
          address: accounts.length,
          blockchain
        }
      );
      const { notify } = useNotifications();
      notify({
        title,
        message: description,
        display: true
      });
    }
  },

  async addAccount({ dispatch }, payload: BlockchainAccountPayload) {
    const { awaitTask } = useTasks();
    const { address, blockchain } = payload;
    const taskType = TaskType.ADD_ACCOUNT;
    const { taskId } = await api.addBlockchainAccount(payload);

    const { result } = await awaitTask<BlockchainBalances, BlockchainMetadata>(
      taskId,
      taskType,
      {
        title: i18n.tc(
          'actions.balances.blockchain_account_add.task.title',
          0,
          {
            blockchain
          }
        ),
        description: i18n.tc(
          'actions.balances.blockchain_account_add.task.description',
          0,
          { address }
        ),
        blockchain,
        numericKeys: []
      } as BlockchainMetadata
    );

    try {
      const balances = BlockchainBalances.parse(result);
      await dispatch('updateBalances', {
        chain: blockchain,
        balances: balances
      });

      useDefiStore().reset();
      useMainStore().resetDefiStatus();
      dispatch(BalanceActions.FETCH_NF_BALANCES);

      if (blockchain === Blockchain.ETH) {
        if (payload.modules) {
          const { enableModule } = useSettingsStore();
          await enableModule({
            enable: payload.modules,
            addresses: [address]
          });

          const { fetchV3Balances } = useUniswapStore();
          fetchV3Balances();
        }

        await dispatch('fetchBlockchainBalances', {
          blockchain: Blockchain.ETH2
        });
      }
      await dispatch('refreshPrices', { ignoreCache: false });
    } catch (e: any) {
      logger.error(e);
      const title = i18n.tc(
        'actions.balances.blockchain_account_add.error.title',
        0,
        { address, blockchain }
      );
      const description = i18n.tc(
        'actions.balances.blockchain_account_add.error.description',
        0,
        {
          error: e.message
        }
      );
      const { notify } = useNotifications();
      notify({
        title,
        message: description,
        display: true
      });
    }
  },

  async editAccount({ commit }, payload: BlockchainAccountPayload) {
    const { blockchain } = payload;
    const isBtc = blockchain === Blockchain.BTC;
    const isBch = blockchain === Blockchain.BCH;
    if (isBtc || isBch) {
      const accountData = await api.editBtcAccount(payload, blockchain);
      if (isBtc) {
        commit('btcAccounts', accountData);
      } else {
        commit('bchAccounts', accountData);
      }
    } else {
      const accountData = await api.editAccount(payload);

      const { fetchEthNames } = useEthNamesStore();
      if (blockchain === Blockchain.ETH) {
        fetchEthNames();
        commit('ethAccounts', accountData);
      } else if (blockchain === Blockchain.KSM) {
        commit('ksmAccounts', accountData);
      } else if (blockchain === Blockchain.DOT) {
        commit('dotAccounts', accountData);
      } else if (blockchain === Blockchain.AVAX) {
        commit('avaxAccounts', accountData);
      }
    }
  },

  async accounts({ commit }, blockchains: Blockchain[] | null) {
    const error = (error: any, blockchain: Blockchain) => {
      logger.error(error);
      const { notify } = useNotifications();
      notify({
        title: i18n.t('actions.get_accounts.error.title').toString(),
        message: i18n
          .t('actions.get_accounts.error.description', {
            blockchain: Blockchain[blockchain],
            message: error.message
          })
          .toString(),
        display: true
      });
    };
    const getAccounts = async (
      blockchain: Exclude<
        Blockchain,
        Blockchain.BTC | Blockchain.BCH | Blockchain.ETH2
      >
    ) => {
      try {
        const accounts = await api.accounts(blockchain);
        if (blockchain === Blockchain.ETH) {
          commit('ethAccounts', accounts);

          const addresses = accounts.map(account => account.address);
          const { fetchEnsNames } = useEthNamesStore();
          fetchEnsNames(addresses, true);
        } else if (blockchain === Blockchain.KSM) {
          commit('ksmAccounts', accounts);
        } else if (blockchain === Blockchain.DOT) {
          commit('dotAccounts', accounts);
        } else if (blockchain === Blockchain.AVAX) {
          commit('avaxAccounts', accounts);
        } else {
          throw Error(`invalid argument ${Blockchain[blockchain]}`);
        }
      } catch (e) {
        error(e, blockchain);
      }
    };

    const getBtcAccounts = async (
      blockchain: Blockchain.BTC | Blockchain.BCH
    ) => {
      try {
        const accounts = await api.btcAccounts(blockchain);
        commit(
          blockchain === Blockchain.BTC ? 'btcAccounts' : 'bchAccounts',
          accounts
        );
      } catch (e) {
        error(e, blockchain);
      }
    };

    const getEth2Validators = async () => {
      const { activeModules } = useGeneralSettingsStore();
      if (!activeModules.includes(Module.ETH2)) {
        return;
      }
      try {
        const validators = await api.balances.getEth2Validators();
        commit('eth2Validators', validators);
      } catch (e: any) {
        error(e, Blockchain.ETH2);
      }
    };

    const requests: Promise<void>[] = [];

    const addRequest = <T extends Blockchain>(
      blockchain: T,
      getRequest: (blockchain: T) => Promise<void>
    ) => {
      if (
        !blockchains ||
        blockchains.length === 0 ||
        blockchains.includes(blockchain)
      ) {
        requests.push(getRequest(blockchain));
      }
    };

    addRequest(Blockchain.ETH, chain => getAccounts(chain));
    addRequest(Blockchain.ETH2, () => getEth2Validators());
    addRequest(Blockchain.BTC, chain => getBtcAccounts(chain));
    addRequest(Blockchain.BCH, chain => getBtcAccounts(chain));
    addRequest(Blockchain.KSM, chain => getAccounts(chain));
    addRequest(Blockchain.DOT, chain => getAccounts(chain));
    addRequest(Blockchain.AVAX, chain => getAccounts(chain));

    await Promise.allSettled(requests);
  },
  /* Remove a tag from all accounts of the state */
  async removeTag({ commit, state }, tagName: string) {
    // Other Network
    ['ethAccounts', 'ksmAccounts', 'dotAccounts', 'avaxAccounts'].forEach(
      stateName => {
        const accounts = state[
          stateName as keyof BalanceState
        ] as GeneralAccountData[];
        removeTags(accounts, tagName);
      }
    );

    // Bitcoin Network
    ['btcAccounts', 'bchAccounts'].forEach(stateName => {
      const accounts = state[stateName as keyof BalanceState] as BtcAccountData;
      const standalone = removeTags(accounts.standalone, tagName);

      const xpubs: XpubAccountData[] = [];

      for (let i = 0; i < accounts.xpubs.length; i++) {
        const xpub = accounts.xpubs[i];
        xpubs.push({
          ...xpub,
          tags: removeTag(xpub.tags, tagName),
          addresses: xpub.addresses ? removeTags(xpub.addresses, tagName) : null
        });
      }

      commit(stateName, {
        standalone,
        xpubs
      });
    });
  },
  async fetchNetvalueData({ commit }) {
    const { premium } = usePremiumStore();
    const { nftsInNetValue } = useFrontendSettingsStore();
    if (!premium) {
      return;
    }
    try {
      const netvalueData = await api.queryNetvalueData(nftsInNetValue);
      commit('netvalueData', netvalueData);
    } catch (e: any) {
      const { notify } = useNotifications();
      notify({
        title: i18n.t('actions.balances.net_value.error.title').toString(),
        message: i18n
          .t('actions.balances.net_value.error.message', { message: e.message })
          .toString(),
        display: false
      });
    }
  },

  async adjustPrices({ commit, state }): Promise<void> {
    const pricesStore = useBalancePricesStore();
    const { prices } = storeToRefs(pricesStore);
    const { updateBalancesPrices } = pricesStore;

    const { manualBalancesData } = storeToRefs(useManualBalancesStore());

    const totals = { ...state.totals };
    const eth = { ...state.eth };
    const btc: BtcBalances = {
      standalone: state.btc.standalone ? { ...state.btc.standalone } : {},
      xpubs: state.btc.xpubs ? [...state.btc.xpubs] : []
    };
    const bch: BtcBalances = {
      standalone: state.bch.standalone ? { ...state.bch.standalone } : {},
      xpubs: state.bch.xpubs ? [...state.bch.xpubs] : []
    };
    const kusama = { ...state.ksm };
    const polkadot = { ...state.dot };
    const avalanche = { ...state.avax };

    for (const asset in totals) {
      const assetPrice = get(prices)[asset];
      if (!assetPrice) {
        continue;
      }
      totals[asset] = {
        amount: totals[asset].amount,
        usdValue: totals[asset].amount.times(assetPrice)
      };
    }
    commit('updateTotals', totals);

    const newManualBalancesData = get(manualBalancesData).map(item => {
      const assetPrice = get(prices)[item.asset];
      if (!assetPrice) {
        return item;
      }
      return {
        ...item,
        usdValue: item.amount.times(assetPrice)
      };
    });

    set(manualBalancesData, newManualBalancesData);

    for (const address in eth) {
      const balances = eth[address];
      eth[address] = {
        assets: updateBalancesPrices(balances.assets),
        liabilities: updateBalancesPrices(balances.liabilities)
      };
    }

    commit('updateEth', eth);

    const btcPrice = get(prices)[Blockchain.BTC];
    if (btcPrice) {
      for (const address in btc.standalone) {
        const balance = btc.standalone[address];
        btc.standalone[address] = {
          amount: balance.amount,
          usdValue: balance.amount.times(btcPrice)
        };
      }
      const xpubs = btc.xpubs;
      if (xpubs) {
        for (let i = 0; i < xpubs.length; i++) {
          const xpub = xpubs[i];
          for (const address in xpub.addresses) {
            const balance = xpub.addresses[address];
            xpub.addresses[address] = {
              amount: balance.amount,
              usdValue: balance.amount.times(btcPrice)
            };
          }
        }
      }
    }

    commit('updateBtc', btc);

    const bchPrice = get(prices)[Blockchain.BCH];
    if (bchPrice) {
      for (const address in bch.standalone) {
        const balance = bch.standalone[address];
        bch.standalone[address] = {
          amount: balance.amount,
          usdValue: balance.amount.times(bchPrice)
        };
      }
      const xpubs = bch.xpubs;
      if (xpubs) {
        for (let i = 0; i < xpubs.length; i++) {
          const xpub = xpubs[i];
          for (const address in xpub.addresses) {
            const balance = xpub.addresses[address];
            xpub.addresses[address] = {
              amount: balance.amount,
              usdValue: balance.amount.times(bchPrice)
            };
          }
        }
      }
    }

    commit('updateBch', bch);

    for (const address in kusama) {
      const balances = kusama[address];
      kusama[address] = {
        assets: updateBalancesPrices(balances.assets),
        liabilities: updateBalancesPrices(balances.liabilities)
      };
    }

    commit('updateKsm', kusama);

    for (const address in avalanche) {
      const balances = avalanche[address];
      avalanche[address] = {
        assets: updateBalancesPrices(balances.assets),
        liabilities: updateBalancesPrices(balances.liabilities)
      };
    }

    commit('updateAvax', avalanche);

    for (const address in polkadot) {
      const balances = polkadot[address];
      polkadot[address] = {
        assets: updateBalancesPrices(balances.assets),
        liabilities: updateBalancesPrices(balances.liabilities)
      };
    }

    commit('updateDot', polkadot);

    const { exchangeBalances } = storeToRefs(useExchangeBalancesStore());

    const exchanges = { ...(get(exchangeBalances) as ExchangeData) };

    for (const exchange in exchanges) {
      exchanges[exchange] = updateBalancesPrices(exchanges[exchange]);
    }

    set(exchangeBalances, exchanges);
  },

  async refreshPrices({ dispatch }, payload: FetchPricePayload): Promise<void> {
    setStatus(Status.LOADING, Section.PRICES);
    const { fetchPrices, fetchExchangeRates } = useBalancePricesStore();
    await fetchExchangeRates();
    await fetchPrices(payload);
    await dispatch('adjustPrices');
    setStatus(Status.LOADED, Section.PRICES);
  },

  async fetchLoopringBalances({ commit }, refresh: boolean) {
    const { activeModules } = useGeneralSettingsStore();
    if (!activeModules.includes(Module.LOOPRING)) {
      return;
    }

    const section = Section.L2_LOOPRING_BALANCES;
    const currentStatus = getStatus(section);

    if (
      isLoading(currentStatus) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);
    const { awaitTask } = useTasks();
    try {
      const taskType = TaskType.L2_LOOPRING;
      const { taskId } = await api.balances.loopring();
      const { result } = await awaitTask<AccountAssetBalances, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.t('actions.balances.loopring.task.title').toString(),
          numericKeys: balanceKeys
        }
      );

      commit(BalanceMutations.UPDATE_LOOPRING_BALANCES, result);
    } catch (e: any) {
      const { notify } = useNotifications();
      notify({
        title: i18n.t('actions.balances.loopring.error.title').toString(),
        message: i18n
          .t('actions.balances.loopring.error.description', {
            error: e.message
          })
          .toString(),
        display: true
      });
    }
    setStatus(Status.LOADED, section);
  },

  async fetchTokenDetails(_, address: string): Promise<ERC20Token> {
    const { awaitTask } = useTasks();
    try {
      const taskType = TaskType.ERC20_DETAILS;
      const { taskId } = await api.erc20details(address);
      const { result } = await awaitTask<ERC20Token, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n
            .t('actions.assets.erc20.task.title', { address })
            .toString(),
          numericKeys: balanceKeys
        }
      );
      return result;
    } catch (e: any) {
      const { notify } = useNotifications();
      notify({
        title: i18n
          .t('actions.assets.erc20.error.title', { address })
          .toString(),
        message: i18n
          .t('actions.assets.erc20.error.description', {
            message: e.message
          })
          .toString(),
        display: true
      });
      return {};
    }
  },

  async [BalanceActions.FETCH_NF_BALANCES](
    { commit },
    payload?: { ignoreCache: boolean }
  ): Promise<void> {
    const { awaitTask } = useTasks();
    const { activeModules } = useGeneralSettingsStore();
    if (!activeModules.includes(Module.NFTS)) {
      return;
    }
    const section = Section.NON_FUNGIBLE_BALANCES;
    try {
      setStatus(Status.LOADING, section);
      const taskType = TaskType.NF_BALANCES;
      const { taskId } = await api.balances.fetchNfBalances(payload);
      const { result } = await awaitTask<NonFungibleBalances, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.t('actions.nft_balances.task.title').toString(),
          numericKeys: []
        }
      );

      commit(
        BalanceMutations.UPDATE_NF_BALANCES,
        NonFungibleBalances.parse(result)
      );
      setStatus(Status.LOADED, section);
    } catch (e: any) {
      logger.error(e);
      const { notify } = useNotifications();
      notify({
        title: i18n.t('actions.nft_balances.error.title').toString(),
        message: i18n
          .t('actions.nft_balances.error.message', {
            message: e.message
          })
          .toString(),
        display: true
      });
      setStatus(Status.NONE, section);
    }
  },
  async addEth2Validator({ dispatch }, payload: Eth2Validator) {
    const { awaitTask } = useTasks();
    const { activeModules } = useGeneralSettingsStore();
    if (!activeModules.includes(Module.ETH2)) {
      return;
    }
    const id = payload.publicKey || payload.validatorIndex;
    try {
      const taskType = TaskType.ADD_ETH2_VALIDATOR;
      const { taskId } = await api.balances.addEth2Validator(payload);
      const { result } = await awaitTask<Boolean, TaskMeta>(taskId, taskType, {
        title: i18n.t('actions.add_eth2_validator.task.title').toString(),
        description: i18n
          .t('actions.add_eth2_validator.task.description', { id })
          .toString(),
        numericKeys: []
      });
      if (result) {
        const { resetStatus } = getStatusUpdater(Section.STAKING_ETH2);
        await dispatch('fetchBlockchainBalances', {
          blockchain: Blockchain.ETH2,
          ignoreCache: true
        });
        resetStatus();
        resetStatus(Section.STAKING_ETH2_DEPOSITS);
        resetStatus(Section.STAKING_ETH2_STATS);
      }

      return result;
    } catch (e: any) {
      logger.error(e);
      const { setMessage } = useMainStore();
      setMessage({
        description: i18n
          .t('actions.add_eth2_validator.error.description', {
            id,
            message: e.message
          })
          .toString(),
        title: i18n.t('actions.add_eth2_validator.error.title').toString(),
        success: false
      });
      return false;
    }
  },
  async editEth2Validator({ dispatch }, payload: Eth2Validator) {
    const { activeModules } = useGeneralSettingsStore();
    if (!activeModules.includes(Module.ETH2)) {
      return;
    }

    const id = payload.validatorIndex;
    try {
      const success = await api.balances.editEth2Validator(payload);

      if (success) {
        const { resetStatus } = getStatusUpdater(Section.STAKING_ETH2);
        await dispatch('fetchBlockchainBalances', {
          blockchain: Blockchain.ETH2,
          ignoreCache: true
        });
        resetStatus();
        resetStatus(Section.STAKING_ETH2_DEPOSITS);
        resetStatus(Section.STAKING_ETH2_STATS);
      }

      return success;
    } catch (e: any) {
      const { setMessage } = useMainStore();
      logger.error(e);
      const message: Message = {
        description: i18n
          .t('actions.edit_eth2_validator.error.description', {
            id,
            message: e.message
          })
          .toString(),
        title: i18n.t('actions.edit_eth2_validator.error.title').toString(),
        success: false
      };
      await setMessage(message);
      return false;
    }
  },
  async deleteEth2Validators({ state, commit }, validators: string) {
    const { setMessage } = useMainStore();
    try {
      const entries = [...state.eth2Validators.entries];
      const eth2Validators = entries.filter(({ publicKey }) =>
        validators.includes(publicKey)
      );
      const success = await api.balances.deleteEth2Validators(eth2Validators);
      if (success) {
        const remainingValidators = entries.filter(
          ({ publicKey }) => !validators.includes(publicKey)
        );
        const data: Eth2Validators = {
          entriesLimit: state.eth2Validators.entriesLimit,
          entriesFound: remainingValidators.length,
          entries: remainingValidators
        };
        commit('eth2Validators', data);
        const balances = { ...state.eth2 };
        for (const validator of validators) {
          delete balances[validator];
        }
        commit('updateEth2', balances);
      }
      return success;
    } catch (e: any) {
      logger.error(e);
      setMessage({
        description: i18n
          .t('actions.delete_eth2_validator.error.description', {
            message: e.message
          })
          .toString(),
        title: i18n.t('actions.delete_eth2_validator.error.title').toString(),
        success: false
      });
      return false;
    }
  }
};
