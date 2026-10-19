import type { Project, ProjectAgent } from '@elizaos/core'
import { character } from './character.ts'
import { dexraTraderPlugin } from './plugins/dexra-trader/index.ts'

export const projectAgent: ProjectAgent = {
  character,
  // Local plugin: buy and sell through the Dexra-guarded core in src/core.
  plugins: [dexraTraderPlugin],
}

const project: Project = {
  agents: [projectAgent],
}

export { character }
export default project
