import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toQueryKeys } from "./keys";
import type { KeyInput } from "./types";

/** Keys to invalidate after a mutation — a static list, or a fn of the result. */
export type FancyMutationInvalidates<TData, TVars> =
  | readonly KeyInput[]
  | ((data: TData, variables: TVars) => readonly KeyInput[]);

export interface UseFancyMutationOptions<TData, TError, TVars, TCtx>
  extends UseMutationOptions<TData, TError, TVars, TCtx> {
  /** Query keys to invalidate once the mutation succeeds. */
  invalidates?: FancyMutationInvalidates<TData, TVars>;
}

/**
 * `useMutation` that invalidates the given query keys on success, then runs any
 * caller-supplied `onSuccess`. Everything else (optimistic `onMutate`,
 * `onError`, `onSettled`, …) passes straight through to TanStack Query.
 *
 *   const { mutate, isPending } = useFancyMutation({
 *     mutationFn: (payload) => api.post("/api/org/compass-tools", payload),
 *     invalidates: ["org-tools", "org-tool-slots"],
 *   });
 */
export function useFancyMutation<
  TData = unknown,
  TError = Error,
  TVars = void,
  TCtx = unknown,
>(
  options: UseFancyMutationOptions<TData, TError, TVars, TCtx>,
): UseMutationResult<TData, TError, TVars, TCtx> {
  const queryClient = useQueryClient();
  const { invalidates, onSuccess, ...rest } = options;

  return useMutation<TData, TError, TVars, TCtx>({
    ...rest,
    // TanStack Query v5 passes (data, variables, onMutateResult, context).
    // Forward all four through to the caller's onSuccess unchanged.
    onSuccess: async (data, variables, onMutateResult, context) => {
      const keys =
        typeof invalidates === "function"
          ? invalidates(data, variables)
          : invalidates;

      await Promise.all(
        toQueryKeys(keys).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );

      await onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}
