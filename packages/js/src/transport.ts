/** The HTTP seam used by the SDK. It defaults to global `fetch` and stays injectable for hosts. */
export type TrainHeroicTransport = (url: string, init: RequestInit) => Promise<Response>;

export const defaultTrainHeroicTransport: TrainHeroicTransport = (url, init) => fetch(url, init);
