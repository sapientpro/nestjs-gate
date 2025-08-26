import {
  ForwardReference,
  Inject,
  OnApplicationBootstrap,
  Type,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Policy } from './decorators';
import { GateResponse } from './gate.response';

type Result = boolean | null | GateResponse | undefined;
type PolicyResult = Promise<Result> | Result;

type PolicyMap = Record<
  string,
  (user: unknown, ...args: any[]) => PolicyResult
> & {
  before?: (user: unknown, ability: string, ...args: any[]) => PolicyResult;
};

type AbilityCallback<U = any> = (user: U, ...args: any[]) => PolicyResult;

type BeforeCallback<U = any> = (
  user: U,
  ability: string,
  args: any[],
) => PolicyResult;

type AfterCallback<U = any> = (
  user: U,
  ability: string,
  result: boolean | null | undefined,
  args: any[],
) => PolicyResult;

export class GateService implements OnApplicationBootstrap {
  @Inject()
  private readonly discoveryService!: DiscoveryService;

  private policies = new Map<Type, PolicyMap>();
  private abilities = new Map<string, AbilityCallback>();
  private beforeCallbacks = new Array<BeforeCallback<any>>();
  private afterCallbacks = new Array<AfterCallback>();
  private readonly rls = new AsyncLocalStorage<unknown>();

  onApplicationBootstrap() {
    this.discoveryService
      .getProviders({ metadataKey: Policy.KEY })
      .forEach((wrapper) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let meta: Type | ForwardReference<() => Type> = Reflect.getMetadata(
          Policy.KEY,
          wrapper.metatype as Type,
        );
        if (Object.hasOwn(meta, 'forwardRef')) {
          meta = (<ForwardReference<() => Type>>meta).forwardRef();
        }
        this.policies.set(<Type>meta, wrapper.instance as PolicyMap);
      });
    console.log(this.policies);
  }

  /**
   * Determine if a given ability has been defined.
   */
  public has(abilities: string | string[]) {
    abilities = Array.isArray(abilities) ? abilities : [abilities];

    return abilities.every((ability) => this.abilities.has(ability));
  }

  /**
   * Define a new ability.
   */
  public define<U>(ability: string, callback: AbilityCallback<U>) {
    this.abilities.set(ability, callback);

    return this;
  }

  /**
   * Register a callback to run before all Gate checks.
   */
  public before<U>(callback: BeforeCallback<U>) {
    this.beforeCallbacks.push(callback);

    return this;
  }

  /**
   * Register a callback to run after all Gate checks.
   */
  public after<U>(callback: AfterCallback<U>) {
    this.afterCallbacks.push(callback);

    return this;
  }

  /**
   * Determine if all of the given abilities should be granted for the current user.
   */
  public async allows(ability: string | string[], args: unknown[] = []) {
    return await this.check(ability, args);
  }

  /**
   * Determine if any of the given abilities should be denied for the current user.
   */
  public async denies(ability: string | string[], args: unknown[] = []) {
    return !(await this.allows(ability, args));
  }

  /**
   * Determine if all of the given abilities should be granted for the current user.
   */
  public async check(abilities: string | string[], args: unknown[] = []) {
    abilities = Array.isArray(abilities) ? abilities : [abilities];
    for (const ability of abilities) {
      if (!(await this.inspect(ability, args)).allowed) {
        return false;
      }
    }
    return true;
  }

  /**
   * Determine if any one of the given abilities should be granted for the current user.
   */
  public async any(abilities: string | string[], args: unknown[] = []) {
    abilities = Array.isArray(abilities) ? abilities : [abilities];
    for (const ability of abilities) {
      if ((await this.inspect(ability, args)).allowed) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine if all of the given abilities should be denied for the current user.
   */
  public async none(abilities: string | string[], args: unknown[] = []) {
    return !(await this.any(abilities, args));
  }

  /**
   * Determine if the given ability should be granted for the current user.
   */
  public async authorize(ability: string, args: unknown[] = []) {
    return (await this.inspect(ability, args)).authorize();
  }

  /**
   * Inspect the user for the given ability.
   */
  public async inspect(ability: string, args: unknown[] = []) {
    const result = await this.raw(ability, args);

    if (result instanceof GateResponse) {
      return result;
    }

    return result ? GateResponse.allow() : GateResponse.deny();
  }

  /**
   * Get the raw result from the authorization callback.
   */
  public async raw(ability: string, args: unknown[] = []) {
    const user = await this.resolveUser();

    // First we will call the "before" callbacks for the Gate. If any of these give
    // back a non-null response, we will immediately return that result in order
    // to let the developers override all checks for some authorization cases.
    let result =
      (await this.callBeforeCallbacks(user, ability, args)) ??
      (await this.callAuthCallback(user, ability, args));

    // After calling the authorization callback, we will call the "after" callbacks
    // that are registered with the Gate, which allows a developer to do logging
    // if that is required for this application. Then we'll return the result.
    result = await this.callAfterCallbacks(user, ability, args, result);

    return result;
  }

  /**
   * Call all of the before callbacks and return if a result is given.
   */
  protected async callBeforeCallbacks(
    user: any,
    ability: string,
    args: unknown[],
  ) {
    for (const before of this.beforeCallbacks) {
      const result = await before(user, ability, args);
      if (result !== null && result !== undefined) {
        return result;
      }
    }
    return null;
  }

  /**
   * Call all of the after callbacks with check result.
   */
  protected async callAfterCallbacks(
    user: any,
    ability: string,
    args: unknown[],
    result: boolean | GateResponse | null | undefined,
  ) {
    for (const after of this.afterCallbacks) {
      result ??= await after(user, ability, result, args);
    }

    return result;
  }

  /**
   * Resolve and call the appropriate authorization callback.
   */
  protected callAuthCallback(user: any, ability: string, args: unknown[]) {
    const callback = this.resolveAuthCallback(user, ability, args);

    return callback(user, ...args);
  }

  /**
   * Resolve the callable for the given ability and arguments.
   */
  protected resolveAuthCallback(
    user: any,
    ability: string,
    args: unknown[],
  ): AbilityCallback {
    let policy: PolicyMap | false, callback: AbilityCallback | false;
    if (
      args[0] &&
      (policy = this.getPolicyFor(args[0])) &&
      (callback = this.resolvePolicyCallback(user, ability, args, policy))
    ) {
      return callback;
    }

    if (this.abilities.has(ability)) {
      return this.abilities.get(ability)!;
    }

    return () => {
      return null;
    };
  }

  /**
   * Get a policy instance for a given class.
   */
  public getPolicyFor(obj: object | Type) {
    const target = typeof obj === 'object' ? obj.constructor : obj;

    if (this.policies.has(<Type>target)) {
      return this.policies.get(<Type>target)!;
    }

    // $policy = this.getPolicyFromAttribute(target); //ToDo

    const proto: unknown = typeof obj === 'object' ? obj : obj.prototype;
    for (const [target, policy] of this.policies) {
      if (proto instanceof target) {
        return policy;
      }
    }

    return false;
  }

  /**
   * Resolve the callback for a policy check.
   */
  protected resolvePolicyCallback(
    user: any,
    ability: string,
    args: any[],
    policy: PolicyMap,
  ) {
    const method = this.formatAbilityToMethod(ability);
    if (typeof policy[method] !== 'function') {
      return false;
    }

    return async () => {
      // This callback will be responsible for calling the policy's before method and
      // running this policy method if necessary. This is used to when objects are
      // mapped to policy objects in the user's configurations or on this class.
      return (
        (await this.callPolicyBefore(policy, user, ability, args)) ??
        // When we receive a non-null result from this before method, we will return it
        // as the "final" results. This will allow developers to override the checks
        // in this policy to return the result for all rules defined in the class.
        (await this.callPolicyMethod(policy, method, user, args))
      );
    };
  }

  /**
   * Call the "before" method on the given policy, if applicable.
   */
  protected callPolicyBefore(
    policy: PolicyMap,
    user: any,
    ability: string,
    args: unknown[],
  ) {
    if (typeof policy['before'] !== 'function') {
      return;
    }

    return policy['before'](user, ability, ...args);
  }

  /**
   * Call the appropriate method on the given policy.
   */
  protected async callPolicyMethod(
    policy: PolicyMap,
    method: string,
    user: any,
    args: unknown[],
  ) {
    // If this first argument is a string, that means they are passing a class name
    // to the policy. We will remove the first argument from this argument array
    // because this policy already knows what type of models it can authorize.
    if (typeof args[0] === 'function') {
      args.shift();
    }

    return policy[method](user, ...args);
  }

  /**
   * Format the policy ability into a method name.
   */
  protected formatAbilityToMethod(ability: string): string {
    if (ability.includes('-'))
      return ability
        .toLowerCase()
        .split(/[-_\s]+/)
        .map((word, index) =>
          index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join('');
    return ability;
  }

  protected resolveUser(): unknown {
    return this.rls.getStore();
  }

  public runWithUser<R, TArgs extends any[]>(
    user: unknown,
    callback: (...args: TArgs) => R,
    ...args: TArgs
  ): R {
    return this.rls.run(user, callback, ...args);
  }
}
