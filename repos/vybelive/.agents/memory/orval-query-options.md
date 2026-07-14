---
name: Orval query hook options require queryKey
description: Passing a `query` options object to a generated useQuery hook fails typecheck unless queryKey is included
---

When calling an Orval-generated `useGet*` React Query hook with custom options
(e.g. `{ query: { refetchInterval, enabled } }`), TanStack Query v5's
`UseQueryOptions` type requires `queryKey`. Omitting it produces
`TS2741: Property 'queryKey' is missing`.

**Fix:** import the generated `getGet<Op>QueryKey(...)` helper and pass it:
```ts
useGetTypingState(conversationId, {
  query: {
    queryKey: getGetTypingStateQueryKey(conversationId),
    refetchInterval: 3000,
    enabled: Boolean(conversationId),
  },
});
```
Both the hook and its `getGet*QueryKey` helper are exported from
`@workspace/api-client-react`.

**Why:** the no-options call path defaults the queryKey internally, but as soon
as you supply a `query` object the full `UseQueryOptions` shape is type-checked.

**How to apply:** any time you add `refetchInterval`/`enabled`/etc. to a
generated query hook, also pass the matching `getGet*QueryKey(...)`.

Related: FlatList `renderItem={({ item }) => ...}` infers `item` as `any` when
the generic isn't pinned; annotate `({ item }: { item: SomeType })` to avoid
`TS7006` under noImplicitAny.
