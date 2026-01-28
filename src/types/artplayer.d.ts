/// <reference types="hls.js" />

import type Hls from 'hls.js';

declare module 'artplayer' {
    export interface Artplayer {
        hls?: Hls;
    }
}
