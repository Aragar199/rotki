import {
  AssetBalance,
  AssetBalanceWithPrice,
  Balance,
  BigNumber,
  HasBalance
} from '@rotki/common';
import { GeneralAccount } from '@rotki/common/lib/account';
import { Blockchain } from '@rotki/common/lib/blockchain';
import { Eth2ValidatorEntry } from '@rotki/common/lib/staking/eth2';
import { get } from '@vueuse/core';
import { forEach } from 'lodash';
import isEmpty from 'lodash/isEmpty';
import { storeToRefs } from 'pinia';
import { TRADE_LOCATION_BLOCKCHAIN } from '@/data/defaults';
import { bigNumberSum } from '@/filters';
import { BlockchainAssetBalances } from '@/services/balances/types';
import { GeneralAccountData } from '@/services/types-api';
import { useAssetInfoRetrieval, useIgnoredAssetsStore } from '@/store/assets';
import { samePriceAssets } from '@/store/balances/const';
import { useExchangeBalancesStore } from '@/store/balances/exchanges';
import { useManualBalancesStore } from '@/store/balances/manual';
import { useBalancePricesStore } from '@/store/balances/prices';
import {
  AccountAssetBalances,
  AssetBreakdown,
  BalanceByLocation,
  BalanceState,
  BlockchainAccountWithBalance,
  BlockchainTotal,
  SubBlockchainTotal,
  NonFungibleBalance
} from '@/store/balances/types';
import { Section, Status } from '@/store/const';
import { useGeneralSettingsStore } from '@/store/settings/general';
import { RotkehlchenState } from '@/store/types';
import { Getters } from '@/store/typing';
import { getStatus } from '@/store/utils';
import { Writeable } from '@/types';
import { ExchangeData, ExchangeInfo } from '@/types/exchanges';
import { L2_LOOPRING } from '@/types/protocols';
import { ReadOnlyTag } from '@/types/user';
import { NoPrice, sortDesc, Zero } from '@/utils/bignumbers';
import { assetSum, balanceSum } from '@/utils/calculation';
import { uniqueStrings } from '@/utils/data';

export interface BalanceGetters {
  ethAccounts: BlockchainAccountWithBalance[];
  eth2Balances: BlockchainAccountWithBalance[];
  ethAddresses: string[];
  btcAccounts: BlockchainAccountWithBalance[];
  bchAccounts: BlockchainAccountWithBalance[];
  kusamaBalances: BlockchainAccountWithBalance[];
  avaxAccounts: BlockchainAccountWithBalance[];
  polkadotBalances: BlockchainAccountWithBalance[];
  loopringAccounts: BlockchainAccountWithBalance[];
  totals: AssetBalance[];
  aggregatedBalances: AssetBalanceWithPrice[];
  aggregatedAssets: string[];
  liabilities: AssetBalanceWithPrice[];
  blockchainTotal: BigNumber;
  blockchainTotals: BlockchainTotal[];
  accountAssets: (account: string) => AssetBalance[];
  accountLiabilities: (account: string) => AssetBalance[];
  hasDetails: (account: string) => boolean;
  accounts: GeneralAccount[];
  account: (address: string) => GeneralAccount | undefined;
  eth2Account: (publicKey: string) => GeneralAccount | undefined;
  isEthereumToken: (asset: string) => boolean;
  assetBreakdown: (asset: string) => AssetBreakdown[];
  loopringBalances: (address: string) => AssetBalance[];
  blockchainAssets: AssetBalanceWithPrice[];
  locationBreakdown: (location: string) => AssetBalanceWithPrice[];
  byLocation: BalanceByLocation;
  nfTotalValue: (includeLPToken: boolean) => BigNumber;
  nfBalances: NonFungibleBalance[];
}

function balances(
  accounts: GeneralAccountData[],
  balances: BlockchainAssetBalances,
  blockchain: Exclude<Blockchain, 'BTC'>
): BlockchainAccountWithBalance[] {
  const data: BlockchainAccountWithBalance[] = [];
  for (const account of accounts) {
    const accountAssets = balances[account.address];

    const balance: Balance = accountAssets
      ? {
          amount: accountAssets?.assets[blockchain]?.amount ?? Zero,
          usdValue: assetSum(accountAssets.assets)
        }
      : { amount: Zero, usdValue: Zero };

    data.push({
      address: account.address,
      label: account.label ?? '',
      tags: account.tags ?? [],
      chain: blockchain,
      balance
    });
  }
  return data;
}

export const getters: Getters<
  BalanceState,
  BalanceGetters,
  RotkehlchenState,
  any
> = {
  ethAccounts: ({
    eth,
    ethAccounts,
    loopringBalances
  }: BalanceState): BlockchainAccountWithBalance[] => {
    const accounts = balances(ethAccounts, eth, Blockchain.ETH);

    return accounts.map(ethAccount => {
      const address = ethAccount.address;
      const tags = ethAccount.tags ? [...ethAccount.tags] : [];

      // check if account have loopring balances
      const loopringAssetBalances = loopringBalances[address];
      if (loopringAssetBalances) {
        tags.push(ReadOnlyTag.LOOPRING);
      }

      return {
        ...ethAccount,
        tags: tags.filter(uniqueStrings)
      };
    });
  },
  eth2Balances: ({
    eth2,
    eth2Validators
  }: BalanceState): BlockchainAccountWithBalance[] => {
    const balances: BlockchainAccountWithBalance[] = [];
    for (const {
      publicKey,
      validatorIndex,
      ownershipPercentage
    } of eth2Validators.entries) {
      const validatorBalances = eth2[publicKey];
      let balance: Balance = { amount: Zero, usdValue: Zero };
      if (validatorBalances && validatorBalances.assets) {
        const assets = validatorBalances.assets;
        balance = {
          amount: assets[Blockchain.ETH2].amount,
          usdValue: assetSum(assets)
        };
      }
      balances.push({
        address: publicKey,
        chain: Blockchain.ETH2,
        balance,
        label: validatorIndex.toString() ?? '',
        tags: [],
        ownershipPercentage
      });
    }
    return balances;
  },
  ethAddresses: ({ ethAccounts }) => {
    return ethAccounts.map(({ address }) => address);
  },
  kusamaBalances: ({ ksmAccounts, ksm }) => {
    return balances(ksmAccounts, ksm, Blockchain.KSM);
  },
  avaxAccounts: ({
    avaxAccounts,
    avax
  }: BalanceState): BlockchainAccountWithBalance[] => {
    return balances(avaxAccounts, avax, Blockchain.AVAX);
  },
  polkadotBalances: ({ dotAccounts, dot }) => {
    return balances(dotAccounts, dot, Blockchain.DOT);
  },
  btcAccounts: ({
    btc,
    btcAccounts
  }: BalanceState): BlockchainAccountWithBalance[] => {
    const accounts: BlockchainAccountWithBalance[] = [];

    const { standalone, xpubs } = btcAccounts;
    const zeroBalance = () => ({
      amount: Zero,
      usdValue: Zero
    });

    for (const { address, label, tags } of standalone) {
      const balance = btc.standalone?.[address] ?? zeroBalance();
      accounts.push({
        address,
        label: label ?? '',
        tags: tags ?? [],
        chain: Blockchain.BTC,
        balance
      });
    }

    for (const { addresses, derivationPath, label, tags, xpub } of xpubs) {
      accounts.push({
        chain: Blockchain.BTC,
        xpub,
        derivationPath: derivationPath ?? '',
        address: '',
        label: label ?? '',
        tags: tags ?? [],
        balance: zeroBalance()
      });

      if (!addresses) {
        continue;
      }

      for (const { address, label, tags } of addresses) {
        const { xpubs } = btc;
        if (!xpubs) {
          continue;
        }
        const index = xpubs.findIndex(xpub => xpub.addresses[address]) ?? -1;
        const balance =
          index >= 0 ? xpubs[index].addresses[address] : zeroBalance();
        accounts.push({
          chain: Blockchain.BTC,
          xpub: xpub,
          derivationPath: derivationPath ?? '',
          address: address,
          label: label ?? '',
          tags: tags ?? [],
          balance: balance
        });
      }
    }
    return accounts;
  },
  bchAccounts: ({
    bch,
    bchAccounts
  }: BalanceState): BlockchainAccountWithBalance[] => {
    const accounts: BlockchainAccountWithBalance[] = [];

    const { standalone, xpubs } = bchAccounts;
    const zeroBalance = () => ({
      amount: Zero,
      usdValue: Zero
    });

    for (const { address, label, tags } of standalone) {
      const balance = bch.standalone?.[address] ?? zeroBalance();
      accounts.push({
        address,
        label: label ?? '',
        tags: tags ?? [],
        chain: Blockchain.BCH,
        balance
      });
    }

    for (const { addresses, derivationPath, label, tags, xpub } of xpubs) {
      accounts.push({
        chain: Blockchain.BCH,
        xpub,
        derivationPath: derivationPath ?? '',
        address: '',
        label: label ?? '',
        tags: tags ?? [],
        balance: zeroBalance()
      });

      if (!addresses) {
        continue;
      }

      for (const { address, label, tags } of addresses) {
        const { xpubs } = bch;
        if (!xpubs) {
          continue;
        }
        const index = xpubs.findIndex(xpub => xpub.addresses[address]) ?? -1;
        const balance =
          index >= 0 ? xpubs[index].addresses[address] : zeroBalance();
        accounts.push({
          chain: Blockchain.BCH,
          xpub: xpub,
          derivationPath: derivationPath ?? '',
          address: address,
          label: label ?? '',
          tags: tags ?? [],
          balance: balance
        });
      }
    }
    return accounts;
  },
  loopringAccounts: ({
    loopringBalances,
    ethAccounts
  }): BlockchainAccountWithBalance[] => {
    const accounts: BlockchainAccountWithBalance[] = [];
    for (const address in loopringBalances) {
      const assets = loopringBalances[address];

      const tags =
        ethAccounts.find(account => account.address === address)?.tags || [];

      const balance = {
        amount: Zero,
        usdValue: Zero
      };

      for (const asset in assets) {
        const assetBalance = assets[asset];

        const sum = balanceSum(balance, assetBalance);
        balance.amount = sum.amount;
        balance.usdValue = sum.usdValue;
      }

      accounts.push({
        address,
        balance,
        chain: Blockchain.ETH,
        label: '',
        tags: [...tags, ReadOnlyTag.LOOPRING].filter(uniqueStrings)
      });
    }
    return accounts;
  },

  totals: ({ totals }): AssetBalance[] => {
    const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
    const { isAssetIgnored } = useIgnoredAssetsStore();
    const ownedAssets: Record<string, Balance> = {};

    forEach(totals, (value: Balance, asset: string) => {
      const associatedAsset: string = get(getAssociatedAssetIdentifier(asset));

      const ownedAsset = ownedAssets[associatedAsset];

      ownedAssets[associatedAsset] = !ownedAsset
        ? {
            ...value
          }
        : {
            ...balanceSum(ownedAsset, value)
          };
    });

    return Object.keys(ownedAssets)
      .filter(asset => !get(isAssetIgnored(asset)))
      .map(asset => ({
        asset,
        amount: ownedAssets[asset].amount,
        usdValue: ownedAssets[asset].usdValue
      }))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },

  aggregatedBalances: (
    { loopringBalances }: BalanceState,
    { totals }
  ): AssetBalanceWithPrice[] => {
    const { prices } = storeToRefs(useBalancePricesStore());
    const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
    const { isAssetIgnored } = useIgnoredAssetsStore();
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

    const exchangeStore = useExchangeBalancesStore();
    const { connectedExchanges } = storeToRefs(exchangeStore);

    const exchanges = get(connectedExchanges)
      .map(({ location }) => location)
      .filter(uniqueStrings);

    for (const exchange of exchanges) {
      const balances = get(exchangeStore.getBalances(exchange));
      balances.forEach((value: AssetBalance) => addToOwned(value));
    }

    totals.forEach((value: AssetBalance) => addToOwned(value));

    const { manualBalances } = storeToRefs(useManualBalancesStore());
    get(manualBalances).forEach(value => addToOwned(value));

    for (const address in loopringBalances) {
      const balances = loopringBalances[address];
      for (const asset in balances) {
        addToOwned({
          ...balances[asset],
          asset
        });
      }
    }

    return Object.keys(ownedAssets)
      .filter(asset => !get(isAssetIgnored(asset)))
      .map(asset => ({
        asset,
        amount: ownedAssets[asset].amount,
        usdValue: ownedAssets[asset].usdValue,
        usdPrice: (get(prices)[asset] as BigNumber) ?? NoPrice
      }))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },

  liabilities: ({ liabilities }) => {
    const { prices } = storeToRefs(useBalancePricesStore());
    const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
    const { isAssetIgnored } = useIgnoredAssetsStore();
    const liabilitiesMerged: Record<string, Balance> = {};

    const addToLiabilities = (value: AssetBalance) => {
      const associatedAsset: string = get(
        getAssociatedAssetIdentifier(value.asset)
      );

      const liability = liabilitiesMerged[associatedAsset];

      liabilitiesMerged[associatedAsset] = !liability
        ? {
            ...value
          }
        : {
            ...balanceSum(liability, value)
          };
    };

    forEach(liabilities, (balance: Balance, asset: string) => {
      addToLiabilities({ asset, ...balance });
    });

    const { manualLiabilities } = storeToRefs(useManualBalancesStore());
    get(manualLiabilities).forEach(balance => addToLiabilities(balance));

    return Object.keys(liabilitiesMerged)
      .filter(asset => !get(isAssetIgnored(asset)))
      .map(asset => ({
        asset,
        amount: liabilitiesMerged[asset].amount,
        usdValue: liabilitiesMerged[asset].usdValue,
        usdPrice: (get(prices)[asset] as BigNumber) ?? NoPrice
      }))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },

  blockchainTotal: (_, { totals }) => {
    return bigNumberSum(totals.map(asset => asset.usdValue));
  },

  blockchainTotals: (state, getters, _rootState): BlockchainTotal[] => {
    const sum = (accounts: HasBalance[]): BigNumber => {
      return bigNumberSum(accounts.map(account => account.balance.usdValue));
    };

    const totals: BlockchainTotal[] = [];
    const ethAccounts: BlockchainAccountWithBalance[] = getters.ethAccounts;
    const btcAccounts: BlockchainAccountWithBalance[] = getters.btcAccounts;
    const bchAccounts: BlockchainAccountWithBalance[] = getters.bchAccounts;
    const kusamaBalances: BlockchainAccountWithBalance[] =
      getters.kusamaBalances;
    const polkadotBalances: BlockchainAccountWithBalance[] =
      getters.polkadotBalances;
    const avaxAccounts: BlockchainAccountWithBalance[] = getters.avaxAccounts;
    const eth2Balances: BlockchainAccountWithBalance[] = getters.eth2Balances;
    const loopring: AccountAssetBalances = state.loopringBalances;

    if (ethAccounts.length > 0) {
      const ethStatus = getStatus(Section.BLOCKCHAIN_ETH);
      const childrenTotals: SubBlockchainTotal[] = [];

      if (Object.keys(loopring).length > 0) {
        const balances: { [asset: string]: HasBalance } = {};
        for (const address in loopring) {
          for (const asset in loopring[address]) {
            if (!balances[asset]) {
              balances[asset] = {
                balance: loopring[address][asset]
              };
            } else {
              balances[asset] = {
                balance: balanceSum(
                  loopring[address][asset],
                  balances[asset].balance
                )
              };
            }
          }
        }
        const loopringStatus = getStatus(Section.L2_LOOPRING_BALANCES);
        childrenTotals.push({
          protocol: L2_LOOPRING,
          usdValue: sum(Object.values(balances)),
          loading:
            loopringStatus === Status.NONE || loopringStatus === Status.LOADING
        });
      }

      totals.push({
        chain: Blockchain.ETH,
        children: childrenTotals.sort((a, b) =>
          sortDesc(a.usdValue, b.usdValue)
        ),
        usdValue: sum(ethAccounts),
        loading: ethStatus === Status.NONE || ethStatus === Status.LOADING
      });
    }

    if (btcAccounts.length > 0) {
      const btcStatus = getStatus(Section.BLOCKCHAIN_BTC);
      totals.push({
        chain: Blockchain.BTC,
        children: [],
        usdValue: sum(btcAccounts),
        loading: btcStatus === Status.NONE || btcStatus === Status.LOADING
      });
    }

    if (bchAccounts.length > 0) {
      const bchStatus = getStatus(Section.BLOCKCHAIN_BCH);
      totals.push({
        chain: Blockchain.BCH,
        children: [],
        usdValue: sum(bchAccounts),
        loading: bchStatus === Status.NONE || bchStatus === Status.LOADING
      });
    }

    if (kusamaBalances.length > 0) {
      const ksmStatus = getStatus(Section.BLOCKCHAIN_KSM);
      totals.push({
        chain: Blockchain.KSM,
        children: [],
        usdValue: sum(kusamaBalances),
        loading: ksmStatus === Status.NONE || ksmStatus === Status.LOADING
      });
    }

    if (avaxAccounts.length > 0) {
      const avaxStatus = getStatus(Section.BLOCKCHAIN_AVAX);
      totals.push({
        chain: Blockchain.AVAX,
        children: [],
        usdValue: sum(avaxAccounts),
        loading: avaxStatus === Status.NONE || avaxStatus === Status.LOADING
      });
    }

    if (polkadotBalances.length > 0) {
      const dotStatus = getStatus(Section.BLOCKCHAIN_DOT);
      totals.push({
        chain: Blockchain.DOT,
        children: [],
        usdValue: sum(polkadotBalances),
        loading: dotStatus === Status.NONE || dotStatus === Status.LOADING
      });
    }

    if (eth2Balances.length > 0) {
      const eth2Status = getStatus(Section.BLOCKCHAIN_ETH2);
      totals.push({
        chain: Blockchain.ETH2,
        children: [],
        usdValue: sum(eth2Balances),
        loading: eth2Status === Status.NONE || eth2Status === Status.LOADING
      });
    }

    return totals
      .filter(item => item.usdValue.gt(0))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },

  accountAssets: (state: BalanceState) => (account: string) => {
    const { isAssetIgnored } = useIgnoredAssetsStore();
    const ethAccount = state.eth[account];
    if (!ethAccount || isEmpty(ethAccount)) {
      return [];
    }

    return Object.entries(ethAccount.assets)
      .filter(([asset]) => !get(isAssetIgnored(asset)))
      .map(
        ([asset, { amount, usdValue }]) =>
          ({
            asset,
            amount,
            usdValue
          } as AssetBalance)
      );
  },

  accountLiabilities: (state: BalanceState) => (account: string) => {
    const { isAssetIgnored } = useIgnoredAssetsStore();
    const ethAccount = state.eth[account];
    if (!ethAccount || isEmpty(ethAccount)) {
      return [];
    }

    return Object.entries(ethAccount.liabilities)
      .filter(([asset]) => !get(isAssetIgnored(asset)))
      .map(
        ([asset, { amount, usdValue }]) =>
          ({
            asset,
            amount,
            usdValue
          } as AssetBalance)
      );
  },

  hasDetails: (state: BalanceState) => (account: string) => {
    const ethAccount = state.eth[account];
    const loopringBalance = state.loopringBalances[account] || {};
    if (!ethAccount || isEmpty(ethAccount)) {
      return false;
    }

    const assetsCount = Object.entries(ethAccount.assets).length;
    const liabilitiesCount = Object.entries(ethAccount.liabilities).length;
    const loopringsCount = Object.entries(loopringBalance).length;

    return assetsCount + liabilitiesCount + loopringsCount > 1;
  },

  accounts: (
    _,
    {
      ethAccounts,
      btcAccounts,
      bchAccounts,
      kusamaBalances,
      polkadotBalances,
      avaxAccounts
    }
  ): GeneralAccount[] => {
    return ethAccounts
      .concat(btcAccounts)
      .concat(bchAccounts)
      .concat(kusamaBalances)
      .concat(polkadotBalances)
      .concat(avaxAccounts)
      .filter((account: BlockchainAccountWithBalance) => !!account.address)
      .map((account: BlockchainAccountWithBalance) => ({
        chain: account.chain,
        address: account.address,
        label: account.label,
        tags: account.tags
      }));
  },

  account: (_, getters) => (address: string) => {
    const accounts = getters.accounts as GeneralAccount[];
    return accounts.find(acc => acc.address === address);
  },

  eth2Account:
    ({ eth2Validators }: BalanceState) =>
    (publicKey: string) => {
      const validator = eth2Validators.entries.find(
        (eth2Validator: Eth2ValidatorEntry) =>
          eth2Validator.publicKey === publicKey
      );

      if (!validator) return undefined;

      return {
        address: validator.publicKey,
        label: validator.validatorIndex.toString() ?? '',
        tags: [],
        chain: Blockchain.ETH2
      };
    },

  isEthereumToken: () => (asset: string) => {
    const { assetInfo } = useAssetInfoRetrieval();
    const match = get(assetInfo(asset));
    if (match) {
      return match.assetType === 'ethereum token';
    }
    return false;
  },
  aggregatedAssets: (_, { liabilities, aggregatedBalances }) => {
    const additional: string[] = [];
    const liabilitiesAsset = liabilities.map(({ asset }) => {
      const samePrices = samePriceAssets[asset];
      if (samePrices) additional.push(...samePrices);
      return asset;
    });
    const assets = aggregatedBalances.map(({ asset }) => {
      const samePrices = samePriceAssets[asset];
      if (samePrices) additional.push(...samePrices);
      return asset;
    });

    assets.push(...liabilitiesAsset, ...additional);
    return assets.filter(uniqueStrings);
  },
  assetBreakdown:
    (
      {
        btc,
        btcAccounts,
        bch,
        bchAccounts,
        ksmAccounts,
        dotAccounts,
        avaxAccounts,
        eth,
        ethAccounts,
        eth2,
        eth2Validators,
        ksm,
        dot,
        avax,
        loopringBalances
      },
      _
    ) =>
    asset => {
      const breakdown: AssetBreakdown[] = [];

      const { exchangeBalances } = storeToRefs(useExchangeBalancesStore());

      const cexBalances = get(exchangeBalances) as ExchangeData;
      for (const exchange in cexBalances) {
        const exchangeData = cexBalances[exchange];
        if (!exchangeData[asset]) {
          continue;
        }

        breakdown.push({
          address: '',
          location: exchange,
          balance: exchangeData[asset],
          tags: []
        });
      }

      const { manualBalances } = storeToRefs(useManualBalancesStore());

      for (let i = 0; i < get(manualBalances).length; i++) {
        const manualBalance = get(manualBalances)[i];
        if (manualBalance.asset !== asset) {
          continue;
        }

        breakdown.push({
          address: '',
          location: manualBalance.location,
          balance: {
            amount: manualBalance.amount,
            usdValue: manualBalance.usdValue
          },
          tags: manualBalance.tags
        });
      }

      for (const address in eth) {
        const ethBalances = eth[address];
        const assetBalance = ethBalances.assets[asset];
        if (!assetBalance) {
          continue;
        }

        const tags =
          ethAccounts.find(ethAccount => ethAccount.address === address)
            ?.tags || [];

        breakdown.push({
          address,
          location: Blockchain.ETH,
          balance: assetBalance,
          tags
        });
      }

      for (const address in loopringBalances) {
        const existing: Writeable<AssetBreakdown> | undefined = breakdown.find(
          value => value.address === address
        );
        const balanceElement = loopringBalances[address][asset];
        if (!balanceElement) {
          continue;
        }
        if (existing) {
          existing.balance = balanceSum(existing.balance, balanceElement);
        } else {
          breakdown.push({
            address,
            location: Blockchain.ETH,
            balance: loopringBalances[address][asset],
            tags: [ReadOnlyTag.LOOPRING]
          });
        }
      }

      if (asset === Blockchain.BTC) {
        const { standalone, xpubs } = btc;
        if (standalone) {
          for (const address in standalone) {
            const btcBalance = standalone[address];
            const tags =
              btcAccounts?.standalone.find(
                btcAccount => btcAccount.address === address
              )?.tags || [];

            breakdown.push({
              address,
              location: Blockchain.BTC,
              balance: btcBalance,
              tags
            });
          }
        }

        if (xpubs) {
          for (let i = 0; i < xpubs.length; i++) {
            const xpub = xpubs[i];
            const addresses = xpub.addresses;
            const tags = btcAccounts?.xpubs[i].tags;
            for (const address in addresses) {
              const btcBalance = addresses[address];

              breakdown.push({
                address,
                location: Blockchain.BTC,
                balance: btcBalance,
                tags
              });
            }
          }
        }
      }

      if (asset === Blockchain.BCH) {
        const { standalone, xpubs } = bch;
        if (standalone) {
          for (const address in standalone) {
            const bchBalance = standalone[address];
            const tags =
              bchAccounts?.standalone.find(
                bchAccount => bchAccount.address === address
              )?.tags || [];

            breakdown.push({
              address,
              location: Blockchain.BCH,
              balance: bchBalance,
              tags
            });
          }
        }

        if (xpubs) {
          for (let i = 0; i < xpubs.length; i++) {
            const xpub = xpubs[i];
            const addresses = xpub.addresses;
            const tags = bchAccounts?.xpubs[i].tags;
            for (const address in addresses) {
              const bchBalance = addresses[address];

              breakdown.push({
                address,
                location: Blockchain.BCH,
                balance: bchBalance,
                tags
              });
            }
          }
        }
      }

      for (const address in ksm) {
        const balances = ksm[address];
        const assetBalance = balances.assets[asset];
        if (!assetBalance) {
          continue;
        }
        const tags =
          ksmAccounts.find(ksmAccount => ksmAccount.address === address)
            ?.tags || [];

        breakdown.push({
          address,
          location: Blockchain.KSM,
          balance: assetBalance,
          tags
        });
      }

      for (const address in dot) {
        const balances = dot[address];
        const assetBalance = balances.assets[asset];
        if (!assetBalance) {
          continue;
        }

        const tags =
          dotAccounts.find(dotAccount => dotAccount.address === address)
            ?.tags || [];

        breakdown.push({
          address,
          location: Blockchain.DOT,
          balance: assetBalance,
          tags
        });
      }

      for (const address in avax) {
        const balances = avax[address];
        const assetBalance = balances.assets[asset];
        if (!assetBalance) {
          continue;
        }

        const tags =
          avaxAccounts.find(avaxAccount => avaxAccount.address === address)
            ?.tags || [];

        breakdown.push({
          address,
          location: Blockchain.AVAX,
          balance: assetBalance,
          tags
        });
      }

      const { treatEth2AsEth } = storeToRefs(useGeneralSettingsStore());

      if (asset === 'ETH2' || (get(treatEth2AsEth) && asset === 'ETH')) {
        for (const { publicKey } of eth2Validators.entries) {
          const validatorBalances = eth2[publicKey];
          let balance: Balance = { amount: Zero, usdValue: Zero };
          if (validatorBalances && validatorBalances.assets) {
            const assets = validatorBalances.assets;
            balance = {
              amount: assets['ETH2'].amount,
              usdValue: assetSum(assets)
            };
          }

          breakdown.push({
            address: publicKey,
            location: Blockchain.ETH2,
            balance,
            tags: []
          });
        }
      }

      return breakdown;
    },
  loopringBalances: state => address => {
    const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
    const { isAssetIgnored } = useIgnoredAssetsStore();
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

    const loopringBalance = state.loopringBalances[address];
    if (loopringBalance) {
      for (const asset in loopringBalance) {
        addToOwned({
          asset,
          ...loopringBalance[asset]
        });
      }
    }
    return Object.keys(ownedAssets)
      .filter(asset => !get(isAssetIgnored(asset)))
      .map(asset => ({
        asset,
        amount: ownedAssets[asset].amount,
        usdValue: ownedAssets[asset].usdValue
      }))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },
  blockchainAssets: ({ loopringBalances }, { totals }) => {
    const { prices } = storeToRefs(useBalancePricesStore());
    const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
    const { isAssetIgnored } = useIgnoredAssetsStore();
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

    totals.forEach(total => addToOwned(total));

    for (const address in loopringBalances) {
      const accountBalances = loopringBalances[address];

      forEach(accountBalances, (balance: Balance, asset: string) => {
        addToOwned({ asset, ...balance });
      });
    }

    return Object.keys(ownedAssets)
      .filter(asset => !get(isAssetIgnored(asset)))
      .map(asset => ({
        asset,
        amount: ownedAssets[asset].amount,
        usdValue: ownedAssets[asset].usdValue,
        usdPrice: (get(prices)[asset] as BigNumber) ?? NoPrice
      }))
      .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
  },
  locationBreakdown:
    ({ loopringBalances }: BalanceState, { totals }) =>
    identifier => {
      const { prices } = storeToRefs(useBalancePricesStore());
      const { getAssociatedAssetIdentifier } = useAssetInfoRetrieval();
      const { isAssetIgnored } = useIgnoredAssetsStore();
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

      const exchangeStore = useExchangeBalancesStore();
      const { connectedExchanges } = storeToRefs(exchangeStore);

      const exchange = get(connectedExchanges).find(
        ({ location }) => identifier === location
      );

      if (exchange) {
        const balances = get(exchangeStore.getBalances(exchange.location));
        balances.forEach((value: AssetBalance) => addToOwned(value));
      }

      if (identifier === TRADE_LOCATION_BLOCKCHAIN) {
        totals.forEach((value: AssetBalance) => addToOwned(value));

        for (const address in loopringBalances) {
          const accountBalances = loopringBalances[address];

          forEach(accountBalances, (balance: Balance, asset: string) => {
            addToOwned({ asset, ...balance });
          });
        }
      }

      const { manualBalances } = storeToRefs(useManualBalancesStore());

      get(manualBalances).forEach(value => {
        if (value.location === identifier) {
          addToOwned(value);
        }
      });

      return Object.keys(ownedAssets)
        .filter(asset => !get(isAssetIgnored(asset)))
        .map(asset => ({
          asset,
          amount: ownedAssets[asset].amount,
          usdValue: ownedAssets[asset].usdValue,
          usdPrice: (get(prices)[asset] as BigNumber) ?? NoPrice
        }))
        .sort((a, b) => sortDesc(a.usdValue, b.usdValue));
    },
  byLocation: (state, { blockchainTotal }) => {
    const { exchangeRate } = useBalancePricesStore();
    const byLocations: Record<string, BigNumber> = {};

    const addToOwned = (location: string, value: BigNumber) => {
      const byLocation = byLocations[location];

      byLocations[location] = !byLocation ? value : value.plus(byLocation);
    };

    const { manualBalanceByLocation } = storeToRefs(useManualBalancesStore());

    for (const { location, usdValue } of get(manualBalanceByLocation)) {
      addToOwned(location, usdValue);
    }

    const { currencySymbol } = storeToRefs(useGeneralSettingsStore());
    const mainCurrency = get(currencySymbol);

    const currentExchangeRate = get(exchangeRate(mainCurrency));
    const blockchainTotalConverted = currentExchangeRate
      ? blockchainTotal.multipliedBy(currentExchangeRate)
      : blockchainTotal;

    addToOwned(TRADE_LOCATION_BLOCKCHAIN, blockchainTotalConverted);

    const { exchanges } = storeToRefs(useExchangeBalancesStore());
    for (const { location, total } of get(exchanges) as ExchangeInfo[]) {
      const exchangeBalanceConverted = currentExchangeRate
        ? total.multipliedBy(currentExchangeRate)
        : total;
      addToOwned(location, exchangeBalanceConverted);
    }

    return byLocations;
  },
  nfBalances: ({ nonFungibleBalances }) => {
    const nfBalances: NonFungibleBalance[] = [];
    for (const address in nonFungibleBalances) {
      const addressNfBalance = nonFungibleBalances[address];
      nfBalances.push(...addressNfBalance);
    }
    return nfBalances;
  },

  nfTotalValue:
    (_, { nfBalances }) =>
    (includeLPToken: boolean = false) => {
      return bigNumberSum(
        nfBalances
          .filter(item => includeLPToken || !item.isLp)
          .map(item => item.usdPrice)
      );
    }
};
