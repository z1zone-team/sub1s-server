<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## DB 마이그레이션

스키마 변경은 Prisma Migrate 마이그레이션으로만 반영한다. 운영 DB에 `prisma db push`를 쓰지 않는다.

1. `prisma/schema.prisma`를 수정한다.
2. 로컬 DB에서 `pnpm prisma:migrate --name 설명`(`prisma migrate dev`)을 실행해 `prisma/migrations/<타임스탬프>_설명/migration.sql`을 만들고 함께 커밋한다. 이 명령은 임시(shadow) DB를 만들 수 있는 DB 계정이 필요하다.
   - 컬럼 삭제, NOT NULL 추가처럼 기존 데이터에 영향을 주는 변경은 `--create-only`로 SQL만 만든 뒤 데이터 이전 SQL을 직접 추가한다.
3. 스키마로 표현할 수 없는 인덱스(소문자 기준 유니크 같은 표현식 인덱스, 부분 유니크 등)는 마이그레이션 SQL에 직접 쓰고 이유와 함께 `prisma/sql/`에 남긴다. Prisma가 표현할 수 있는 것은 반드시 `schema.prisma`에 둔다 (스키마에 없는 인덱스는 `migrate dev`가 정리 대상으로 보고 삭제 마이그레이션을 만들 수 있다).
4. PR의 CI가 빈 DB에 `prisma migrate deploy`를 적용하고, 결과가 `schema.prisma`와 같은지 `prisma migrate diff --exit-code`로 검사한다. 스키마만 바꾸고 마이그레이션을 빠뜨리면 CI가 실패한다.
5. `main`에 머지되면 배포가 **서버 컨테이너를 교체하기 전에** `prisma migrate deploy`를 실행한다. 실패하면 배포가 중단되고 기존 서버가 그대로 유지된다. 배포가 겹치지 않도록 `flock`으로 하나씩 실행한다.

마이그레이션이 먼저 적용되는 동안 이전 버전 서버가 새 스키마로 잠시 동작하므로, **컬럼 추가는 한 번에, 삭제나 이름 변경은 두 번에 나눠서**(먼저 새 코드 배포, 다음 릴리스에서 삭제) 한다.

기준선 `20261010210000_init`은 Prisma Migrate 도입 시점의 스키마다. 이미 테이블이 있는 운영 DB는 첫 배포에서 `schema.prisma`와 차이가 없음을 확인한 뒤 이 기준선을 적용 완료로 등록한다(SQL은 실행하지 않음). 차이가 있으면 배포가 실패하므로 운영 DB를 `schema.prisma`에 맞춘 뒤 다시 배포한다.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
