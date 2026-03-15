/**
 * Fleet management: provision and teardown holyshipper containers.
 */

export interface IFleetManager {
  provision(entityId: string, config: ProvisionConfig): Promise<string>;
  teardown(containerId: string): Promise<void>;
}

export interface IServiceKeyRepo {
  getKey(service: string): Promise<string | null>;
  setKey(service: string, key: string): Promise<void>;
}

export interface ProvisionConfig {
  entityId: string;
  flowName: string;
  owner: string;
  repo: string;
  issueNumber: number;
  githubToken: string;
}

/**
 * Provision a holyshipper container for the given entity.
 * Returns the container ID.
 */
export async function provisionHolyshipper(fleetManager: IFleetManager, config: ProvisionConfig): Promise<string> {
  return fleetManager.provision(config.entityId, config);
}

/**
 * Teardown a holyshipper container.
 */
export async function teardownHolyshipper(fleetManager: IFleetManager, containerId: string): Promise<void> {
  await fleetManager.teardown(containerId);
}
