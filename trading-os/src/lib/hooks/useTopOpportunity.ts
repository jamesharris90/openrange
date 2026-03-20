import { useQuery } from "@tanstack/react-query";

import type { Opportunity } from "@/lib/types";
import { fetchOpportunities } from "@/lib/api/opportunities";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function useTopOpportunity() {
  return useQuery<Opportunity[]>({
    queryKey: ["fast", "topOpportunity"],
    queryFn: fetchOpportunities,
    ...QUERY_POLICY.fast,
  });
}
