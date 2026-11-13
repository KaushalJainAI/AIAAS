/** Which component draws each builder screen. The route file looks the section up here. */
import type { ComponentType } from 'react';

import type { AgentSection } from '../config';
import { AutonomyScreen, GuardrailsScreen, OutputScreen, ScheduleScreen, ContextScreen } from './Run';
import { ConnectionsScreen, DelegationScreen, FilesScreen, KnowledgeScreen } from './Access';
import { GrantsScreen, ToolRulesScreen } from './Tools';
import { IdentityScreen, InstructionsScreen } from './Identity';
import { ModelScreen } from './Model';

export const SECTION_SCREENS: Record<AgentSection, ComponentType<{ id: string }>> = {
  identity: IdentityScreen,
  instructions: InstructionsScreen,
  model: ModelScreen,
  grants: GrantsScreen,
  toolRules: ToolRulesScreen,
  connections: ConnectionsScreen,
  knowledge: KnowledgeScreen,
  delegation: DelegationScreen,
  files: FilesScreen,
  autonomy: AutonomyScreen,
  guardrails: GuardrailsScreen,
  output: OutputScreen,
  schedule: ScheduleScreen,
  context: ContextScreen,
};
