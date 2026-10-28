import 'server-only';
import { createAadeClient } from './aade-client';
export type { AadeResult, AadeActivity } from './aade-client';

/** No automatic private-file loading. An authorized server operation must supply its target. */
export function configuredAadeClient() {
  return createAadeClient({
    username: process.env.AADE_USERNAME ?? '',
    password: process.env.AADE_PASSWORD ?? '',
    callerAfm: process.env.AADE_CALLER_AFM ?? '',
  });
}
