import { computed, Ref, ref } from '@vue/composition-api';
import { get, set } from '@vueuse/core';
import { acceptHMRUpdate, defineStore } from 'pinia';
import { getPremium, useModules } from '@/composables/session';
import i18n from '@/i18n';
import { balanceKeys } from '@/services/consts';
import {
  CompoundBalances,
  CompoundHistory
} from '@/services/defi/types/compound';
import { api } from '@/services/rotkehlchen-api';
import { Section, Status } from '@/store/const';
import { toProfitLossModel } from '@/store/defi/utils';
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

export const defaultCompoundHistory = (): CompoundHistory => ({
  events: [],
  debtLoss: {},
  interestProfit: {},
  rewards: {},
  liquidationProfit: {}
});

export const useCompoundStore = defineStore('defi/compound', () => {
  const balances: Ref<CompoundBalances> = ref({});
  const history: Ref<CompoundHistory> = ref(
    defaultCompoundHistory()
  ) as Ref<CompoundHistory>;

  const { resetStatus } = getStatusUpdater(Section.DEFI_COMPOUND_BALANCES);
  const { awaitTask } = useTasks();
  const { notify } = useNotifications();
  const { activeModules } = useModules();
  const premium = getPremium();

  const rewards = computed(() => toProfitLossModel(get(history).rewards));
  const interestProfit = computed(() =>
    toProfitLossModel(get(history).interestProfit)
  );
  const debtLoss = computed(() => toProfitLossModel(get(history).debtLoss));
  const liquidationProfit = computed(() =>
    toProfitLossModel(get(history).liquidationProfit)
  );

  const fetchBalances = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.COMPOUND)) {
      return;
    }

    const section = Section.DEFI_COMPOUND_BALANCES;
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
      const taskType = TaskType.DEFI_COMPOUND_BALANCES;
      const { taskId } = await api.defi.fetchCompoundBalances();
      const { result } = await awaitTask<CompoundBalances, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.compound.task.title'),
          numericKeys: balanceKeys
        }
      );
      set(balances, result);
    } catch (e: any) {
      notify({
        title: i18n.tc('actions.defi.compound.error.title'),
        message: i18n.tc('actions.defi.compound.error.description', undefined, {
          error: e.message
        }),
        display: true
      });
    }
    setStatus(Status.LOADED, section);
  };

  const fetchHistory = async (refresh: boolean = false) => {
    if (!get(activeModules).includes(Module.COMPOUND) || !get(premium)) {
      return;
    }

    const section = Section.DEFI_COMPOUND_HISTORY;
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
      const taskType = TaskType.DEFI_COMPOUND_HISTORY;
      const { taskId } = await api.defi.fetchCompoundHistory();
      const { result } = await awaitTask<CompoundHistory, TaskMeta>(
        taskId,
        taskType,
        {
          title: i18n.tc('actions.defi.compound_history.task.title'),
          numericKeys: balanceKeys
        }
      );

      set(history, result);
    } catch (e: any) {
      notify({
        title: i18n.tc('actions.defi.compound_history.error.title'),
        message: i18n.tc(
          'actions.defi.compound_history.error.description',
          undefined,
          {
            error: e.message
          }
        ),
        display: true
      });
    }
    setStatus(Status.LOADED, section);
  };

  const reset = () => {
    set(balances, {});
    set(history, defaultCompoundHistory());
    resetStatus(Section.DEFI_COMPOUND_BALANCES);
    resetStatus(Section.DEFI_COMPOUND_HISTORY);
  };

  return {
    balances,
    history,
    rewards,
    interestProfit,
    debtLoss,
    liquidationProfit,
    fetchBalances,
    fetchHistory,
    reset
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCompoundStore, import.meta.hot));
}
