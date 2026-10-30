import { z } from "zod";
import { create } from "zustand";

export const REPOSITORY_ADDRESS = "https://github.com/imsvidskiy/ashfolk";

const REPOSITORY_API = "https://api.github.com/repos/imsvidskiy/ashfolk";

const STAR_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" });

const repositorySchema = z.object({ stargazers_count: z.number().int().nonnegative() });

interface StarState {
  readonly hasRequested: boolean;
  readonly stars: number | null;
}

export const useStarStore = create<StarState>(() => {
  return { hasRequested: false, stars: null };
});

async function fetchStars(): Promise<number | null> {
  const response = await fetch(REPOSITORY_API, { headers: { Accept: "application/vnd.github+json" } });

  if (!response.ok) {
    return null;
  }

  const result = repositorySchema.safeParse(await response.json());

  if (!result.success) {
    return null;
  }

  return result.data.stargazers_count;
}

export function requestStars(): void {
  if (useStarStore.getState().hasRequested) {
    return;
  }

  useStarStore.setState({ hasRequested: true });

  fetchStars()
    .then((stars) => {
      useStarStore.setState({ stars });
    })
    .catch((error: unknown) => {
      console.warn("The star count is not available", error);
    });
}

export function formatStars(stars: number): string {
  return STAR_FORMAT.format(stars);
}
