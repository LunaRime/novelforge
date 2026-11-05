/** Immutable application composition; dependencies belong to each instance, never process globals. */
export function createContainer<Ports extends object>(ports: Ports): Readonly<Ports> {
  return Object.freeze({ ...ports })
}

export interface ProjectScope {
  path: string | null
  session: number
}
export class RuntimeScopeChanged extends Error {
  constructor() { super('Runtime project scope changed'); this.name = 'RuntimeScopeChanged' }
}
/** Execute a use case against one captured project session. Check before every delayed side effect. */
export function createRuntime<Ports extends object>(
  ports: Readonly<Ports>,
  scope: () => ProjectScope,
) {
  return {
    ports,
    async run<Result>(work: (context: { ports: Readonly<Ports>; project: ProjectScope; assertCurrent(): void }) => Promise<Result>): Promise<Result> {
      const project = { ...scope() }
      const assertCurrent = () => {
        const current = scope()
        if (current.path !== project.path || current.session !== project.session) throw new RuntimeScopeChanged()
      }
      assertCurrent()
      const result = await work({ ports, project, assertCurrent })
      assertCurrent()
      return result
    },
  }
}
