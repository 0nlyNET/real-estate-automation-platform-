export type RoutingCondition = {
  source?: string;
  type?: string;
  location?: string;
  stage?: string;
};

export type RoutingActionType = 'round_robin_team' | 'fixed_user';

export type RoutingActionConfig = {
  teamId?: string;
  userId?: string;
  requireOnline?: boolean;
};
