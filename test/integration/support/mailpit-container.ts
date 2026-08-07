import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'

export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.30.5@sha256:b868afa176bfd6cce2323ea316cd99ccad77915e51e595748f6d786700ecf109'

export type StartedMailpitContainer = StartedTestContainer

export async function startMailpitContainer(): Promise<StartedMailpitContainer> {
  return new GenericContainer(MAILPIT_IMAGE)
    .withEnvironment({ MP_MAX_MESSAGES: '500' })
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(
      Wait.forAll([
        Wait.forHttp('/readyz', 8025).forStatusCode(200),
        Wait.forListeningPorts(),
      ]),
    )
    .start()
}

export function mailpitApiUrl(container: StartedMailpitContainer): string {
  return `http://${container.getHost()}:${container.getMappedPort(8025)}`
}

export function mailpitSmtpUrl(container: StartedMailpitContainer): string {
  return `smtp://${container.getHost()}:${container.getMappedPort(1025)}`
}
