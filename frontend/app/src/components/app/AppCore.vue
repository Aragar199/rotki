<template>
  <div class="app__content rotki-light-grey">
    <asset-update auto />
    <notification-popup />
    <app-drawer v-if="loginComplete" />

    <v-app-bar
      app
      fixed
      clipped-left
      flat
      :color="appBarColor"
      class="app__app-bar"
    >
      <v-app-bar-nav-icon
        class="secondary--text text--lighten-4"
        @click="toggleDrawer()"
      />
      <app-indicators />
    </v-app-bar>
    <app-sidebars />
    <div
      class="app-main"
      :class="{
        small,
        expanded
      }"
    >
      <v-main>
        <router-view />
      </v-main>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onBeforeMount,
  watch
} from '@vue/composition-api';
import { get } from '@vueuse/core';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { storeToRefs } from 'pinia';
import { useTheme } from '@/composables/common';
import { getPremium } from '@/composables/session';
import { useInterop } from '@/electron-interop';
import { Section, Status } from '@/store/const';
import { useUniswapStore } from '@/store/defi/uniswap';
import { useSessionStore } from '@/store/session';
import { useAreaVisibilityStore } from '@/store/session/visibility';
import { useFrontendSettingsStore } from '@/store/settings/frontend';
import { useStatisticsStore } from '@/store/statistics';
import { getStatus } from '@/store/utils';

export default defineComponent({
  name: 'AppCore',
  components: {
    AppDrawer: defineAsyncComponent(
      () => import('@/components/app/AppDrawer.vue')
    ),
    AppSidebars: defineAsyncComponent(
      () => import('@/components/app/AppSidebars.vue')
    ),
    AppIndicators: defineAsyncComponent(
      () => import('@/components/app/AppIndicators.vue')
    ),
    AssetUpdate: defineAsyncComponent(
      () => import('@/components/status/update/AssetUpdate.vue')
    ),
    NotificationPopup: defineAsyncComponent(
      () => import('@/components/status/notifications/NotificationPopup.vue')
    )
  },
  setup(_, { root }) {
    const { loginComplete } = storeToRefs(useSessionStore());
    const visibilityStore = useAreaVisibilityStore();
    const { showDrawer, isMini } = storeToRefs(visibilityStore);

    const { isMobile, appBarColor } = useTheme();

    const small = computed(() => get(showDrawer) && get(isMini));
    const expanded = computed(
      () => get(showDrawer) && !get(isMini) && !get(isMobile)
    );
    const premium = getPremium();

    const { fetchV3Balances } = useUniswapStore();
    const defiUniswapV3Section = Section.DEFI_UNISWAP_V3_BALANCES;
    const { language } = storeToRefs(useFrontendSettingsStore());
    const { overall } = storeToRefs(useStatisticsStore());

    const { updateTray } = useInterop();

    watch(overall, overall => {
      if (overall.percentage === '-') {
        return;
      }
      updateTray(overall);
    });

    onBeforeMount(() => {
      Chart.defaults.font.family = 'Roboto';
      Chart.register(...registerables);
      Chart.register(zoomPlugin);
    });

    onBeforeMount(() => {
      if (get(language) !== root.$i18n.locale) {
        setLanguage(get(language));
      }
    });

    const setLanguage = (language: string) => {
      root.$i18n.locale = language;
    };

    watch(language, language => {
      setLanguage(language);
    });

    watch(premium, (curr, prev) => {
      const currentStatus = getStatus(defiUniswapV3Section);
      if (prev !== curr && currentStatus !== Status.NONE) {
        fetchV3Balances(true);
      }
    });

    return {
      small,
      expanded,
      appBarColor,
      loginComplete,
      toggleDrawer: visibilityStore.toggleDrawer
    };
  }
});
</script>

<style scoped lang="scss">
::v-deep {
  .v-main {
    padding: 0 !important;
  }

  .v-app-bar {
    &::after {
      height: 1px;
      display: block;
      width: 100%;
      content: '';
      border-bottom: var(--v-rotki-light-grey-darken1) solid thin;
    }
  }
}

.app {
  &__app-bar {
    ::v-deep {
      .v-toolbar {
        &__content {
          padding: 0 1rem;
        }
      }
    }

    &__button {
      i {
        &:focus {
          color: var(--v-primary-base) !important;
        }
      }

      button {
        &:focus {
          color: var(--v-primary-base) !important;
        }
      }
    }
  }

  &-main {
    padding-top: 1rem;
    padding-bottom: 1rem;
    width: 100%;
    min-height: calc(100vh - 64px);

    &.small {
      padding-left: 56px;
    }

    &.expanded {
      padding-left: 300px;
    }
  }
}
</style>
