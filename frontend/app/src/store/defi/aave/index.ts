import { ProfitLossModel } from '@rotki/common/lib/defi';
import { AaveBalances, AaveHistory } from '@rotki/common/lib/defi/aave';
import { computed, ref, Ref } from '@vue/composition-api';
import { get, set } from '@vueuse/core';
import { acceptHMRUpdate, defineStore } from 'pinia';
import { getPremium, useModules } from '@/composables/session';
import i18n from '@/i18n';
import { balanceKeys } from '@/services/consts';
import { aaveHistoryKeys } from '@/services/defi/consts';
import { api } from '@/services/rotkehlchen-api';
import { Section, Status } from '@/store/const';
import { useNotifications } from '@/store/notifications';
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
import { balanceSum } from '@/utils/calculation';

export const useAaveStore = defineStore('defi/aave', () => {
  const balances: Ref<AaveBalances> = ref({});
  const history: Ref<AaveHistory> = ref({});

  const { notify } = useNotifications();
  const { awaitTask } = useTasks();
  const { activeModules } = useModules();
  const premium = getPremium();

  const aaveTotalEarned = (addresses: string[]) =>
    computed(() => {
      const earned: ProfitLossModel[] = [];
      const aaveHistory = get(history);

      for (const address in aaveHistory) {
        if (addresses.length > 0 && !addresses.includes(address)) {
          continue;
        }
        const totalEarned = aaveHistory[address].totalEarnedInterest;
        for (const asset in totalEarned) {
          const index = earned.findIndex(e => e.asset === asset);
          if (index < 0) {
            earned.push({
              address: '',
              asset,
              value: totalEarned[asset]
            });
          } else {
            earned[index] = {
              ...earned[index],
              value: balanceSum(earned[index].value, totalEarned[asset])
            };
          }
        }
      }
      return earned;
    });

  const fetchBalances = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.AAVE)) {
      return;
    }
    const section = Section.DEFI_AAVE_BALANCES;
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
      const taskType = TaskType.AAVE_BALANCES;
      const { taskId } = await api.defi.fetchAaveBalances();
      const { result } = await awaitTask<AaveBalances, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.aave_balances.task.title'),
          numericKeys: balanceKeys
        }
      );
      set(balances, result);
    } catch (e: any) {
      const message = i18n.tc(
        'actions.defi.aave_balances.error.description',
        undefined,
        {
          error: e.message
        }
      );
      const title = i18n.tc('actions.defi.aave_balances.error.title');
      notify({
        title,
        message,
        display: true
      });
    }

    setStatus(Status.LOADED, section);
  };

  const fetchHistory = async (payload: {
    refresh?: boolean;
    reset?: boolean;
  }) => {
    if (!get(activeModules).includes(Module.AAVE) || !get(premium)) {
      return;
    }
    const section = Section.DEFI_AAVE_HISTORY;
    const currentStatus = getStatus(section);
    const refresh = payload?.refresh;
    const reset = payload?.reset;

    if (
      isLoading(currentStatus) ||
      (currentStatus === Status.LOADED && !refresh)
    ) {
      return;
    }

    const newStatus = refresh ? Status.REFRESHING : Status.LOADING;
    setStatus(newStatus, section);

    try {
      const taskType = TaskType.AAVE_HISTORY;
      const { taskId } = await api.defi.fetchAaveHistory(reset);
      const { result } = await awaitTask<AaveHistory, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.aave_history.task.title'),
          numericKeys: aaveHistoryKeys
        }
      );

      set(history, result);
    } catch (e: any) {
      const message = i18n.tc(
        'actions.defi.aave_history.error.description',
        undefined,
        { error: e.message }
      );
      const title = i18n.tc('actions.defi.aave_history.error.title');

      notify({
        title,
        message,
        display: true
      });
    }

    setStatus(Status.LOADED, section);
  };

  const reset = () => {
    const { resetStatus } = getStatusUpdater(Section.DEFI_AAVE_BALANCES);
    set(balances, {});
    set(history, {});
    resetStatus(Section.DEFI_AAVE_BALANCES);
    resetStatus(Section.DEFI_AAVE_HISTORY);
  };

  return {
    balances,
    history,
    aaveTotalEarned,
    fetchBalances,
    fetchHistory,
    reset
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAaveStore, import.meta.hot));
}
