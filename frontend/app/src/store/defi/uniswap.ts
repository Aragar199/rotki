import { AssetBalance, Balance } from '@rotki/common';
import { XswapBalances, XswapEvents } from '@rotki/common/lib/defi/xswap';
import { computed, Ref, ref } from '@vue/composition-api';
import { get, set } from '@vueuse/core';
import { acceptHMRUpdate, defineStore, storeToRefs } from 'pinia';
import { getPremium } from '@/composables/session';
import i18n from '@/i18n';
import { api } from '@/services/rotkehlchen-api';
import { useAssetInfoRetrieval, useIgnoredAssetsStore } from '@/store/assets';
import { Section, Status } from '@/store/const';
import {
  dexTradeNumericKeys,
  uniswapEventsNumericKeys
} from '@/store/defi/const';
import { DexTrades } from '@/store/defi/types';
import {
  getBalances,
  getEventDetails,
  getPoolProfit,
  getPools
} from '@/store/defi/xswap-utils';
import { useNotifications } from '@/store/notifications';
import { usePremiumStore } from '@/store/session/premium';
import { useGeneralSettingsStore } from '@/store/settings/general';
import { useTasks } from '@/store/tasks';
import {
  getStatus,
  getStatusUpdater,
  isLoading,
  setStatus
} from '@/store/utils';
import { Module } from '@/types/modules';
import { TaskMeta } from '@/types/task';
import { TaskType } from '@/types/task-type';
import { sortDesc } from '@/utils/bignumbers';
import { balanceSum } from '@/utils/calculation';
import { uniqueStrings } from '@/utils/data';

export const useUniswapStore = defineStore('defi/uniswap', () => {
  const v2Balances = ref<XswapBalances>({}) as Ref<XswapBalances>;
  const v3Balances = ref<XswapBalances>({}) as Ref<XswapBalances>;
  const trades = ref<DexTrades>({}) as Ref<DexTrades>;
  const events = ref<XswapEvents>({}) as Ref<XswapEvents>;

  const { fetchSupportedAssets } = useAssetInfoRetrieval();
  const { notify } = useNotifications();
  const { awaitTask, isTaskRunning } = useTasks();
  const { activeModules } = storeToRefs(useGeneralSettingsStore());
  const { premium } = storeToRefs(usePremiumStore());

  const uniswapV2Balances = (addresses: string[]) =>
    computed(() => {
      return getBalances(get(v2Balances), addresses, false);
    });

  const uniswapV3Balances = (addresses: string[]) =>
    computed(() => {
      return getBalances(get(v3Balances), addresses, false);
    });

  const uniswapPoolProfit = (addresses: string[]) =>
    computed(() => {
      return getPoolProfit(get(events), addresses);
    });

  const uniswapEvents = (addresses: string[]) =>
    computed(() => {
      return getEventDetails(get(events), addresses);
    });

  const uniswapV2Addresses = computed(() => {
    const uniswapBalances = get(v2Balances);
    const uniswapEvents = get(events);
    return Object.keys(uniswapBalances)
      .concat(Object.keys(uniswapEvents))
      .filter(uniqueStrings);
  });

  const uniswapV3Addresses = computed(() => {
    const uniswapBalances = get(v3Balances);
    const uniswapEvents = get(events);
    return Object.keys(uniswapBalances)
      .concat(Object.keys(uniswapEvents))
      .filter(uniqueStrings);
  });

  const uniswapV2PoolAssets = computed(() => {
    const uniswapBalances = get(v2Balances);
    const uniswapEvents = get(events);
    return getPools(uniswapBalances, uniswapEvents);
  });

  const uniswapV3PoolAssets = computed(() => {
    const uniswapBalances = get(v3Balances);
    return getPools(uniswapBalances, {});
  });

  const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
  const { isAssetIgnored } = useIgnoredAssetsStore();

  const uniswapV3AggregatedBalances = (address: string | string[] = []) =>
    computed<AssetBalance[]>(() => {
      const ownedAssets: Record<string, Balance> = {};

      const addToOwned = (value: AssetBalance) => {
        const associatedAsset: string = get(
          getAssociatedAssetIdentifier(value.asset)
        );

        const ownedAsset = ownedAssets[associatedAsset];

        ownedAssets[associatedAsset] = !ownedAsset
          ? {
              ...value
            }
          : {
              ...balanceSum(ownedAsset, value)
            };
      };

      const balances = get(
        uniswapV3Balances(Array.isArray(address) ? address : [address])
      );

      balances.forEach(balance => {
        const assets = balance.assets;
        assets.forEach(asset => {
          addToOwned({
            ...asset.userBalance,
            asset: asset.asset
          });
        });
      });

      return Object.keys(ownedAssets)
        .filter(asset => !get(isAssetIgnored(asset)))
        .map(asset => ({
          asset,
          amount: ownedAssets[asset].amount,
          usdValue: ownedAssets[asset].usdValue
        }))
        .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
    });

  const fetchV2Balances = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.UNISWAP)) {
      return;
    }

    const section = Section.DEFI_UNISWAP_V2_BALANCES;
    const currentStatus = getStatus(section);

    if (
      isLoading(currentStatus) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);
    try {
      const taskType = TaskType.DEFI_UNISWAP_V2_BALANCES;
      const { taskId } = await api.defi.fetchUniswapV2Balances();
      const { result } = await awaitTask<XswapBalances, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.t('actions.defi.uniswap.task.title', { v: 2 }).toString(),
          numericKeys: []
        }
      );

      set(v2Balances, XswapBalances.parse(result));
    } catch (e: any) {
      notify({
        title: i18n.t('actions.defi.uniswap.error.title', { v: 2 }).toString(),
        message: i18n
          .t('actions.defi.uniswap.error.description', {
            error: e.message,
            v: 2
          })
          .toString(),
        display: true
      });
    }
    setStatus(Status.LOADED, section);

    await fetchSupportedAssets(true);
  };

  const fetchV3Balances = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.UNISWAP)) {
      return;
    }

    const taskType = TaskType.DEFI_UNISWAP_V3_BALANCES;
    const section = Section.DEFI_UNISWAP_V3_BALANCES;
    const currentStatus = getStatus(section);

    if (
      get(isTaskRunning(taskType, { premium: get(getPremium()) })) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);
    try {
      const { taskId } = await api.defi.fetchUniswapV3Balances();
      const taskMeta = {
        title: i18n.t('actions.defi.uniswap.task.title', { v: 3 }).toString(),
        numericKeys: [],
        premium: get(getPremium())
      };

      const { result } = await awaitTask<XswapBalances, TaskMeta>(
        taskId,
        taskType,
        taskMeta
      );

      set(v3Balances, XswapBalances.parse(result));
    } catch (e: any) {
      notify({
        title: i18n.t('actions.defi.uniswap.error.title', { v: 3 }).toString(),
        message: i18n
          .t('actions.defi.uniswap.error.description', {
            error: e.message,
            v: 3
          })
          .toString(),
        display: true
      });
    }
    setStatus(Status.LOADED, section);

    await fetchSupportedAssets(true);
  };

  const fetchTrades = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.UNISWAP) || !get(premium)) {
      return;
    }

    const section = Section.DEFI_UNISWAP_TRADES;
    const currentStatus = getStatus(section);

    if (
      isLoading(currentStatus) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);
    try {
      const taskType = TaskType.DEFI_UNISWAP_TRADES;
      const { taskId } = await api.defi.fetchUniswapTrades();
      const { result } = await awaitTask<DexTrades, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.uniswap_trades.task.title'),
          numericKeys: dexTradeNumericKeys
        }
      );

      set(trades, result);
    } catch (e: any) {
      notify({
        title: i18n.tc('actions.defi.uniswap_trades.error.title'),
        message: i18n.tc(
          'actions.defi.uniswap_trades.error.description',
          undefined,
          {
            error: e.message
          }
        ),
        display: true
      });
    }
    setStatus(Status.LOADED, section);

    await fetchSupportedAssets(true);
  };

  const fetchEvents = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.UNISWAP) || !get(premium)) {
      return;
    }

    const section = Section.DEFI_UNISWAP_EVENTS;
    const currentStatus = getStatus(section);

    if (
      isLoading(currentStatus) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);
    try {
      const taskType = TaskType.DEFI_UNISWAP_EVENTS;
      const { taskId } = await api.defi.fetchUniswapEvents();
      const { result } = await awaitTask<XswapEvents, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.uniswap_events.task.title'),
          numericKeys: uniswapEventsNumericKeys
        }
      );

      set(events, result);
    } catch (e: any) {
      notify({
        title: i18n.tc('actions.defi.uniswap_events.error.title'),
        message: i18n.tc(
          'actions.defi.uniswap_events.error.description',
          undefined,
          {
            error: e.message
          }
        ),
        display: true
      });
    }
    setStatus(Status.LOADED, section);

    await fetchSupportedAssets(true);
  };

  const reset = () => {
    const { resetStatus } = getStatusUpdater(Section.DEFI_UNISWAP_V3_BALANCES);
    set(v2Balances, {});
    set(v3Balances, {});
    set(trades, {});
    set(events, {});

    resetStatus(Section.DEFI_UNISWAP_V2_BALANCES);
    resetStatus(Section.DEFI_UNISWAP_V3_BALANCES);
    resetStatus(Section.DEFI_UNISWAP_TRADES);
    resetStatus(Section.DEFI_UNISWAP_EVENTS);
  };

  return {
    v2Balances,
    v3Balances,
    trades,
    events,
    uniswapV2Addresses,
    uniswapV3Addresses,
    uniswapV2PoolAssets,
    uniswapV3PoolAssets,
    uniswapV2Balances,
    uniswapV3Balances,
    uniswapV3AggregatedBalances,
    uniswapEvents,
    uniswapPoolProfit,
    fetchV2Balances,
    fetchV3Balances,
    fetchTrades,
    fetchEvents,
    reset
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUniswapStore, import.meta.hot));
}
