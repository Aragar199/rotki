<template>
  <div class="mt-12">
    <div class="text-h6">
      {{ $t('frontend_settings.subtitle.refresh') }}
    </div>
    <v-row class="mt-1">
      <v-col class="grow">
        <settings-option
          #default="{ error, success, update }"
          setting="refreshPeriod"
          frontend-setting
          :transform="value => (value ? parseInt(value) : value)"
          :error-message="
            $tc('frontend_settings.validation.refresh_period.error')
          "
          @finished="resetRefreshPeriod"
        >
          <v-text-field
            v-model="refreshPeriod"
            outlined
            :disabled="!refreshEnabled"
            type="number"
            :min="minRefreshPeriod"
            :max="maxRefreshPeriod"
            :label="$t('frontend_settings.label.refresh')"
            persistent-hint
            :hint="$t('frontend_settings.hint.refresh')"
            :success-messages="success"
            :error-messages="
              error || v$.refreshPeriod.$errors.map(e => e.$message)
            "
            @change="callIfValid($event, update)"
          />
        </settings-option>
      </v-col>
      <v-col class="shrink">
        <settings-option
          #default="{ update }"
          setting="refreshPeriod"
          frontend-setting
          :transform="value => (value ? 30 : -1)"
          :error-message="
            $tc('frontend_settings.validation.refresh_period.error')
          "
          @finished="resetRefreshPeriod"
        >
          <v-switch
            v-model="refreshEnabled"
            class="mt-3"
            :label="$t('frontend_settings.label.refresh_enabled')"
            @change="update"
          />
        </settings-option>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from '@vue/composition-api';
import useVuelidate from '@vuelidate/core';
import { between, helpers, required } from '@vuelidate/validators';
import { get, set } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { useValidation } from '@/composables/validation';
import { Constraints } from '@/data/constraints';
import i18n from '@/i18n';
import { useFrontendSettingsStore } from '@/store/settings/frontend';

const refreshPeriod = ref<string>('');
const refreshEnabled = ref<boolean>(false);

const minRefreshPeriod = 30;
const maxRefreshPeriod = Constraints.MAX_MINUTES_DELAY;

const rules = {
  refreshPeriod: {
    required: helpers.withMessage(
      i18n
        .t('frontend_settings.validation.refresh_period.non_empty')
        .toString(),
      required
    ),
    between: helpers.withMessage(
      i18n
        .t('frontend_settings.validation.refresh_period.invalid_period', {
          start: minRefreshPeriod,
          end: maxRefreshPeriod
        })
        .toString(),
      between(minRefreshPeriod, maxRefreshPeriod)
    )
  }
};

const v$ = useVuelidate(rules, { refreshPeriod }, { $autoDirty: true });
const { callIfValid } = useValidation(v$);

const { refreshPeriod: currentPeriod } = storeToRefs(
  useFrontendSettingsStore()
);

const resetRefreshPeriod = () => {
  const period = get(currentPeriod);
  set(refreshEnabled, period > 0);
  set(refreshPeriod, get(refreshEnabled) ? period.toString() : '');
};

onMounted(() => {
  resetRefreshPeriod();
});
</script>
