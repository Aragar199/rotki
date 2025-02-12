import { Eth2Validators } from '@rotki/common/lib/staking/eth2';
import { MutationTree } from 'vuex';
import {
  Balances,
  BlockchainAssetBalances,
  BtcBalances
} from '@/services/balances/types';
import { BtcAccountData, GeneralAccountData } from '@/services/types-api';
import { BalanceMutations } from '@/store/balances/mutation-types';
import { defaultState } from '@/store/balances/state';
import {
  AccountAssetBalances,
  BalanceState,
  NonFungibleBalances
} from '@/store/balances/types';

export const mutations: MutationTree<BalanceState> = {
  updateEth(state: BalanceState, payload: BlockchainAssetBalances) {
    state.eth = { ...payload };
  },
  updateEth2(state: BalanceState, payload: BlockchainAssetBalances) {
    state.eth2 = { ...payload };
  },
  updateBtc(state: BalanceState, payload: BtcBalances) {
    state.btc = { ...payload };
  },
  updateBch(state: BalanceState, payload: BtcBalances) {
    state.bch = { ...payload };
  },
  updateKsm(state: BalanceState, payload: BlockchainAssetBalances) {
    state.ksm = { ...payload };
  },
  updateDot(state: BalanceState, payload: BlockchainAssetBalances) {
    state.dot = { ...payload };
  },
  updateAvax(state: BalanceState, payload: BlockchainAssetBalances) {
    state.avax = { ...payload };
  },
  updateTotals(state: BalanceState, payload: Balances) {
    const totals = { ...state.totals, ...payload };

    for (const asset in totals) {
      if (totals[asset].amount.isZero()) delete totals[asset];
    }

    state.totals = totals;
  },
  updateLiabilities(state: BalanceState, payload: Balances) {
    const liabilities = { ...state.liabilities, ...payload };

    for (const asset in liabilities) {
      if (liabilities[asset].amount.isZero()) delete liabilities[asset];
    }

    state.liabilities = liabilities;
  },
  ethAccounts(state: BalanceState, accounts: GeneralAccountData[]) {
    state.ethAccounts = accounts;
  },
  btcAccounts(state: BalanceState, accounts: BtcAccountData) {
    state.btcAccounts = accounts;
  },
  bchAccounts(state: BalanceState, accounts: BtcAccountData) {
    state.bchAccounts = accounts;
  },
  ksmAccounts(state: BalanceState, accounts: GeneralAccountData[]) {
    state.ksmAccounts = accounts;
  },
  dotAccounts(state: BalanceState, accounts: GeneralAccountData[]) {
    state.dotAccounts = accounts;
  },
  avaxAccounts(state: BalanceState, accounts: GeneralAccountData[]) {
    state.avaxAccounts = accounts;
  },
  eth2Validators(state: BalanceState, eth2Validators: Eth2Validators) {
    state.eth2Validators = eth2Validators;
  },
  [BalanceMutations.UPDATE_LOOPRING_BALANCES](
    state: BalanceState,
    balances: AccountAssetBalances
  ) {
    state.loopringBalances = balances;
  },
  [BalanceMutations.UPDATE_NF_BALANCES](
    state: BalanceState,
    balances: NonFungibleBalances
  ) {
    state.nonFungibleBalances = balances;
  },
  reset(state: BalanceState) {
    Object.assign(state, defaultState());
  }
};
