<template>
  <div class="pb-6">
    <v-container>
      <v-row>
        <v-col cols="12">
          <overall-balances />
        </v-col>
        <v-col cols="12" md="4" lg="4">
          <summary-card
            :name="$t('dashboard.exchange_balances.title')"
            can-refresh
            :is-loading="isExchangeLoading"
            navigates-to="/accounts-balances/exchange-balances/"
            @refresh="refreshBalance($event)"
          >
            <div slot="tooltip">
              {{ $t('dashboard.exchange_balances.tooltip') }}
            </div>
            <div v-if="exchanges.length < 1">
              <v-card-actions class="px-4">
                <v-btn
                  text
                  block
                  color="primary"
                  to="/settings/api-keys/exchanges?add=true"
                  class="py-8"
                >
                  <div class="d-flex flex-column align-center">
                    <v-icon class="mb-2">mdi-plus-circle-outline</v-icon>
                    <span>
                      {{ $t('dashboard.exchange_balances.add') }}
                    </span>
                  </div>
                </v-btn>
              </v-card-actions>
            </div>
            <div v-else>
              <exchange-box
                v-for="exchange in exchanges"
                :key="exchange.location"
                :location="exchange.location"
                :amount="exchange.total"
              />
            </div>
          </summary-card>
        </v-col>
        <v-col cols="12" md="4" lg="4">
          <summary-card
            :name="$tc('dashboard.blockchain_balances.title')"
            :is-loading="isBlockchainLoading"
            can-refresh
            navigates-to="/accounts-balances/"
            @refresh="refreshBalance($event)"
          >
            <div slot="tooltip">
              {{ $tc('dashboard.blockchain_balances.tooltip') }}
            </div>
            <div v-if="blockchainTotals.length === 0">
              <v-card-actions class="px-4">
                <v-btn
                  text
                  block
                  color="primary"
                  to="/accounts-balances/?add=true"
                  class="py-8"
                >
                  <div class="d-flex flex-column align-center">
                    <v-icon class="mb-2">mdi-plus-circle-outline</v-icon>
                    <span>
                      {{ $tc('dashboard.blockchain_balances.add') }}
                    </span>
                  </div>
                </v-btn>
              </v-card-actions>
            </div>
            <div v-else>
              <blockchain-balance-card-list
                v-for="total in blockchainTotals"
                :key="total.chain"
                :total="total"
              />
            </div>
          </summary-card>
        </v-col>
        <v-col cols="12" md="4" lg="4">
          <summary-card
            :name="$tc('dashboard.manual_balances.title')"
            :tooltip="$tc('dashboard.manual_balances.card_tooltip')"
            :is-loading="isManualBalancesLoading"
            can-refresh
            navigates-to="/accounts-balances/manual-balances/"
            @refresh="fetchManualBalances"
          >
            <div slot="tooltip">
              {{ $t('dashboard.manual_balances.tooltip') }}
            </div>
            <div v-if="manualBalanceByLocation.length < 1">
              <v-card-actions class="px-4">
                <v-btn
                  text
                  block
                  color="primary"
                  to="/accounts-balances/manual-balances/?add=true"
                  class="py-8"
                >
                  <div class="d-flex flex-column align-center">
                    <v-icon class="mb-2">mdi-plus-circle-outline</v-icon>
                    <span>
                      {{ $t('dashboard.manual_balances.add') }}
                    </span>
                  </div>
                </v-btn>
              </v-card-actions>
            </div>
            <div v-else>
              <manual-balance-card-list
                v-for="manualBalance in manualBalanceByLocation"
                :key="manualBalance.location"
                :name="manualBalance.location"
                :amount="manualBalance.usdValue"
              />
            </div>
          </summary-card>
        </v-col>
      </v-row>
      <v-row justify="end" class="my-4">
        <v-col cols="auto">
          <price-refresh />
        </v-col>
      </v-row>
      <dashboard-asset-table
        :title="$tc('common.assets')"
        table-type="ASSETS"
        :loading="isAnyLoading"
        :balances="aggregatedBalances"
      />
      <liquidity-provider-balance-table class="mt-8" />
      <dashboard-asset-table
        v-if="liabilities.length > 0"
        class="mt-8"
        table-type="LIABILITIES"
        :title="$tc('dashboard.liabilities.title')"
        :loading="isAnyLoading"
        :balances="liabilities"
      />
      <nft-balance-table data-cy="nft-balance-table" class="mt-8" />
    </v-container>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent
} from '@vue/composition-api';
import { get } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { setupGeneralBalances } from '@/composables/balances';
import { useExchangeBalancesStore } from '@/store/balances/exchanges';
import { useManualBalancesStore } from '@/store/balances/manual';
import { useUniswapStore } from '@/store/defi/uniswap';
import { useTasks } from '@/store/tasks';
import { TaskType } from '@/types/task-type';

export default defineComponent({
  name: 'Dashboard',
  components: {
    PriceRefresh: defineAsyncComponent(
      () => import('@/components/helper/PriceRefresh.vue')
    ),
    DashboardAssetTable: defineAsyncComponent(
      () => import('@/components/dashboard/DashboardAssetTable.vue')
    ),
    OverallBalances: defineAsyncComponent(
      () => import('@/components/dashboard/OverallBalances.vue')
    ),
    SummaryCard: defineAsyncComponent(
      () => import('@/components/dashboard/SummaryCard.vue')
    ),
    ExchangeBox: defineAsyncComponent(
      () => import('@/components/dashboard/ExchangeBox.vue')
    ),
    ManualBalanceCardList: defineAsyncComponent(
      () => import('@/components/dashboard/ManualBalanceCardList.vue')
    ),
    BlockchainBalanceCardList: defineAsyncComponent(
      () => import('@/components/dashboard/BlockchainBalanceCardList.vue')
    ),
    NftBalanceTable: defineAsyncComponent(
      () => import('@/components/dashboard/NftBalanceTable.vue')
    )
  },
  setup() {
    const { isTaskRunning } = useTasks();
    const {
      blockchainTotals,
      aggregatedBalances,
      liabilities,
      fetchBlockchainBalances,
      fetchLoopringBalances
    } = setupGeneralBalances();

    const manualBalancesStore = useManualBalancesStore();
    const { fetchManualBalances } = manualBalancesStore;
    const { manualBalanceByLocation } = storeToRefs(manualBalancesStore);

    const exchangeStore = useExchangeBalancesStore();
    const { exchanges } = storeToRefs(exchangeStore);

    const isQueryingBlockchain = isTaskRunning(
      TaskType.QUERY_BLOCKCHAIN_BALANCES
    );
    const isLoopringLoading = isTaskRunning(TaskType.L2_LOOPRING);
    const isUniswapV3BalancesLoading = isTaskRunning(
      TaskType.DEFI_UNISWAP_V3_BALANCES
    );
    const isBlockchainLoading = computed<boolean>(() => {
      return (
        get(isQueryingBlockchain) ||
        get(isLoopringLoading) ||
        get(isUniswapV3BalancesLoading)
      );
    });

    const isExchangeLoading = isTaskRunning(TaskType.QUERY_EXCHANGE_BALANCES);

    const isAllBalancesLoading = isTaskRunning(TaskType.QUERY_BALANCES);

    const isManualBalancesLoading = isTaskRunning(TaskType.MANUAL_BALANCES);

    const isAnyLoading = computed<boolean>(() => {
      return (
        get(isBlockchainLoading) ||
        get(isExchangeLoading) ||
        get(isAllBalancesLoading) ||
        get(isUniswapV3BalancesLoading)
      );
    });

    const refreshBalance = (balanceSource: string) => {
      if (balanceSource === 'blockchain') {
        fetchBlockchainBalances({
          ignoreCache: true
        });
        fetchLoopringBalances(true);
        const { fetchV3Balances } = useUniswapStore();
        fetchV3Balances();
      } else if (balanceSource === 'exchange') {
        exchangeStore.fetchConnectedExchangeBalances(true);
      }
    };

    return {
      isExchangeLoading,
      isBlockchainLoading,
      isManualBalancesLoading,
      isAnyLoading,
      exchanges,
      blockchainTotals,
      manualBalanceByLocation,
      aggregatedBalances,
      liabilities,
      refreshBalance,
      fetchManualBalances
    };
  }
});
</script>
