import { FileSnapshot, ActionResult, AgentAction, NextExpected } from "./agentDomain";

export interface ActorInput {
  goal: string;
  userRequest: string;
  historySummary: string;
  filesInScope: FileSnapshot[];
  lastToolResults?: ActionResult[];
}

export interface ActorOutput {
  stepSummary?: string;
  actions: AgentAction[];
  nextExpected: NextExpected;
}