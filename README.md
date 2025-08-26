# @sapientpro/nestjs-gate
[![NPM Package](https://img.shields.io/npm/v/@sapientpro/nestjs-gate.svg)](https://www.npmjs.org/package/@sapientpro/nestjs-gate)

Lightweight authorization gate for NestJS with:
- Ability callbacks (define/has/allows/denies/any/none/authorize)
- Policy classes discovered via a decorator
- Before/after hooks for cross‑cutting authorization logic
- Rich GateResponse to return messages and throw HTTP exceptions when denying

This package is designed to be framework‑friendly and minimal, using Nest's DiscoveryModule to automatically find policies.

## Installation

```sh
npm install @sapientpro/nestjs-gate
```

## Quick start

1) Import GateModule and inject GateService

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { GateModule } from '@sapientpro/nestjs-gate';

@Module({
  imports: [GateModule],
})
export class AppModule {}
```

```ts
// some.service.ts
import { Injectable } from '@nestjs/common';
import { GateService } from '@sapientpro/nestjs-gate';

@Injectable()
export class SomeService {
  constructor(private readonly gate: GateService) {}

  async canCreatePost(currentUser: any, postDto: any) {
    // Run checks under a specific user context (see runWithUser below)
    return this.gate.runWithUser(currentUser, () => this.gate.allows('create-post', [postDto]));
  }
}
```

2) Define abilities programmatically (optional)

```ts
// abilities.setup.ts (e.g., inside a module onModuleInit or bootstrap)
import { Injectable, OnModuleInit } from '@nestjs/common';
import { GateService } from '@sapientpro/nestjs-gate';

@Injectable()
export class AbilityBootstrap implements OnModuleInit {
  constructor(private readonly gate: GateService) {}

  onModuleInit() {
    this.gate
      .define('create-post', (user, postDto) => {
        return !!user && user.role === 'editor';
      })
      .define('delete-post', (user, post) => {
        return !!user && (user.role === 'admin' || post.authorId === user.id);
      });
  }
}
```

3) Create policies and use the @Policy decorator

```ts
// post.entity.ts
export class Post {
  constructor(public id: string, public authorId: string, public published: boolean) {}
}
```

```ts
// post.policy.ts
import { Injectable } from '@nestjs/common';
import { Policy } from '@sapientpro/nestjs-gate';
import { Post } from './post.entity';

@Policy(Post)
export class PostPolicy {
  // Optional policy-wide precheck
  before(user: any, ability: string, post?: Post) {
    if (user?.role === 'superadmin') return true; // short-circuit allow
    return null; // continue normal checks
  }

  // Ability methods (name derived from ability string)
  createPost(user: any) {
    return !!user && user.role !== 'banned';
  }

  deletePost(user: any, post: Post) {
    return !!user && (user.role === 'admin' || post.authorId === user.id);
  }
}
```

- Ability name mapping:
  - kebab-case and spaced names are converted to camelCase method names.
  - E.g., 'create-post' -> createPost.

4) Check abilities with a model instance or class

```ts
// using a model instance (policy resolved by instance constructor)
const allowed = await gate.allows('delete-post', [postInstance]);

// using a class as the first arg (policy knows its model type)
const allowed2 = await gate.allows('create-post', [Post]);
```

5) Use before/after hooks for cross-cutting policies

```ts
// on bootstrap
this.gate
  .before((user, ability, args) => {
    // return true/false to short-circuit, or null/undefined to continue
    if (user?.blocked) return false; // deny everything for blocked users
    return null;
  })
  .after((user, ability, result, args) => {
    // observe or adjust result
    if (result === false && ability === 'delete-post' && user?.role === 'moderator') {
      // e.g., grant moderators delete on weekends (demo only)
      const isWeekend = [0, 6].includes(new Date().getDay());
      if (isWeekend) return true;
    }
    return result; // leave as is
  });
```

6) GateResponse and throwing exceptions

```ts
import { GateResponse } from '@sapientpro/nestjs-gate';

// Return rich responses from abilities or policies
this.gate.define('publish-post', (user, post) => {
  if (!user) return GateResponse.deny('Unauthenticated').withStatus(401);
  if (!user.canPublish) return GateResponse.deny('Not allowed');
  return GateResponse.allow();
});

// In handlers/services
await this.gate.runWithUser(currentUser, () => this.gate.authorize('publish-post', [post]));
// authorize() throws 403 by default or the provided status when denied.
```

7) User context with runWithUser

GateService tracks the current user via AsyncLocalStorage. Wrap your checks with runWithUser when you need to pass the user implicitly:

```ts
const result = gate.runWithUser(currentUser, () => gate.allows('create-post', [dto]));
```

You can still pass the user explicitly by designing your ability callbacks to accept the user as the first parameter; GateService calls your ability with (user, ...args) automatically.

Middleware example:

```ts
// auth.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import { GateService } from '@sapientpro/nestjs-gate';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly gateService: GateService) {}

  use(req: Request, _res: Response, next: (err?: any) => void) {
    // Resolve user from the request in your own way
    // e.g., from a session, a JWT, or a header
    const user = (req as any).user; // replace with your real extraction logic

    // Ensure every downstream authorization call runs with this user
    this.gateService.runWithUser(user, next);
  }
}
```

This way, any providers/controllers executed after the middleware can call gate methods (allows/authorize/etc.) without needing to pass the user explicitly.

## API Summary

- GateModule: Nest module that provides GateService. Imports DiscoveryModule internally to discover policies.
- GateService:
  - define(ability, callback)
  - has(ability | ability[])
  - allows(ability | ability[], args?)
  - denies(ability | ability[], args?)
  - any(ability | ability[], args?)
  - none(ability | ability[], args?)
  - authorize(ability, args?) -> throws on denial
  - inspect(ability, args?) -> GateResponse
  - raw(ability, args?) -> boolean | null | GateResponse | undefined
  - before(callback), after(callback)
  - runWithUser(user, callback, ...args)
- Policy decorator: @Policy(ModelOrForwardRef)
- GateResponse: allow/deny factories, withStatus, asNotFound, authorize(), toJSON(), toString()
