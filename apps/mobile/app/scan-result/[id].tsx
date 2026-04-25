import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { ScanProductInfo } from '@gaia/shared/types';

import PurchaseSuccess from '../../components/scan-result/purchase-success';
import Counterfeit from '../../components/scan-result/counterfeit';
import Pending from '../../components/scan-result/pending';
import Expired from '../../components/scan-result/expired';

type ScanOutcomeParam =
  | 'purchase_success'
  | 'return_success'
  | 'pending_confirmation'
  | 'counterfeit'
  | 'expired';

/**
 * Route params passed by the scanner when navigating here.
 *
 * Navigate to this screen with router.replace() from the scanner so the
 * result screen is never in the back-stack — the hardware back and all
 * CTAs unconditionally return to the scanner.
 *
 * Example (scanner side):
 *   router.replace({
 *     pathname: '/scan-result/[id]',
 *     params: {
 *       id: containerId,
 *       outcome: 'purchase_success',
 *       product: JSON.stringify(product),
 *       farmer_points: String(rewards.farmer_points),
 *       months_remaining: String(container.formulation_months_remaining),
 *       step: 'purchase',
 *     },
 *   });
 */
type Params = {
  id: string;
  outcome: string;
  /** JSON-encoded ScanProductInfo */
  product: string | undefined;
  /** ISO-8601 deadline for pending_confirmation */
  deadline: string | undefined;
  farmer_points: string | undefined;
  months_remaining: string | undefined;
  /** 'purchase' | 'return' — distinguishes success screen copy */
  step: string | undefined;
};

function parseProduct(raw: string | undefined): ScanProductInfo | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScanProductInfo;
  } catch {
    return null;
  }
}

function parseDeadline(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export default function ScanResultScreen() {
  const params = useLocalSearchParams<Params>();

  const outcome = params.outcome as ScanOutcomeParam;
  const scanId = params.id;
  const product = parseProduct(params.product);
  const deadline = parseDeadline(params.deadline);
  const farmerPoints = params.farmer_points != null ? parseInt(params.farmer_points, 10) : 0;
  const monthsRemaining: number | undefined =
    params.months_remaining != null ? parseInt(params.months_remaining, 10) : undefined;
  const step = params.step === 'return' ? ('return' as const) : ('purchase' as const);

  const goToScanner = () => {
    router.replace('/');
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goToScanner();
      return true;
    });
    return () => sub.remove();
  }, []);

  switch (outcome) {
    case 'purchase_success':
    case 'return_success':
      return (
        <PurchaseSuccess
          product={product}
          farmerPoints={farmerPoints}
          monthsRemaining={monthsRemaining}
          step={step}
          onBack={goToScanner}
        />
      );

    case 'pending_confirmation':
      if (deadline !== null) {
        return <Pending deadline={deadline} product={product} onBack={goToScanner} />;
      }
      return <Expired onRescan={goToScanner} />;

    case 'counterfeit':
      return <Counterfeit scanId={scanId} onDismiss={goToScanner} />;

    case 'expired':
    default:
      return <Expired onRescan={goToScanner} />;
  }
}
