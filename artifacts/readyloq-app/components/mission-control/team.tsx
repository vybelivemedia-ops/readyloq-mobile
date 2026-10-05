import React from "react";
import { View } from "react-native";
import { useGetMissionControlCompany } from "@workspace/api-client-react";
import { Body, Label, QueryState, Row, Shell, go } from "./ui";
import { RequestAccess } from "./governance";
import { useRouter } from "expo-router";

export function CompanyTeam({ id }: { id: number }) {
  const q = useGetMissionControlCompany(id), router = useRouter();
  return <Shell title={q.data?.name ? `${q.data.name} team` : `Company #${id} team`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <>
      <Label>{q.data.users.length < q.data.userCount ? `FIRST ${q.data.users.length} OF ${q.data.userCount} USERS` : `USERS RETURNED / ${q.data.users.length}`}</Label>
      <Body muted>{q.data.users.length < q.data.userCount
        ? `Showing the first ${q.data.users.length} of ${q.data.userCount} users returned by the company detail API. It caps this list at 250 and does not provide pagination.`
        : "The company detail API returns up to 250 users and does not provide pagination; this is not a pageable roster."}</Body>
      {q.data.users.length ? q.data.users.map(user => <View key={user.id}>
        <Row title={user.name ?? "Name not recorded"} subtitle={`${user.email ?? "Email not recorded"} · ${user.role ?? "No role"}`} meta={`BETA ACCESS ${user.betaAccessEnabled ? "ENABLED" : "DISABLED"} · USER ${user.id}`} onPress={user.role === "technician" ? () => go(router, `/mission-control/technicians/${encodeURIComponent(user.id)}`) : undefined} />
        <RequestAccess targetType="user" targetId={user.id} currentEnabled={user.betaAccessEnabled} />
      </View>) : <Body muted>No users are returned for this company.</Body>}
    </> : <QueryState query={q} />}
  </Shell>;
}