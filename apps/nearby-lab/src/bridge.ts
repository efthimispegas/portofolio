import { requireNativeModule, requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type ExposureOffer = { id: string; url: string; expiresAt: number };
export type ExposureEvent = { state: 'armed' | 'disarmed' | 'invalid'; id?: string; reason?: string };
export const bridge = requireNativeModule<{
  buildProfile(): string;
  randomToken(): string;
  writeEvidence(json: string): void;
}>('PortofolioNearbyBridge');
export const NativeExposure = requireNativeView<ViewProps & {
  offer: ExposureOffer | null;
  onState(event: NativeSyntheticEvent<ExposureEvent>): void;
}>('PortofolioNearbyBridge');
