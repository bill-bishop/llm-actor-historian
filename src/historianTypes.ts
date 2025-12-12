import { AgentAction, ActionResult, NextExpected } from "./agentDomain";

export interface UserTurnDelta {
  message: string;
}

export interface ActorTurnDelta {
  stepSummary?: string;
  actions: AgentAction[];
  nextExpected: NextExpected;
}

export interface ToolResultsDelta {
  results: ActionResult[];
}

export interface HistorianInput {
  goal: string;
  previousHistorySummary: string;
  userTurn?: UserTurnDelta;
  actorTurn?: ActorTurnDelta;
  toolResults?: ToolResultsDelta;
}

export interface HistorianOutput {
  historySummary: string;
}