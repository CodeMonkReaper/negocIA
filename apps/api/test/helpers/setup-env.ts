import { testUrl } from "./env";

/**
 * Fija `DATABASE_URL` al schema de test **en cada worker** antes de que se
 * importe un spec.
 *
 * `PrismaService` construye su cliente con `createPrismaClient(undefined)`, que
 * lee `process.env.DATABASE_URL` en el momento del import. Sin este paso, los
 * specs de integración escribían (y leían) contra el schema `public` — en
 * local, la BD de desarrollo real, que se truncaba entre casos; en CI, una base
 * vacía que revocaban con `42P01`.
 *
 * Los specs siguen pasándole `testUrl()` a `validateEnv` por su cuenta para el
 * ConfigModule de Nest; aquí solo se completa la mitad que el ConfigModule no
 * cubre. El e2e no pasa por aquí porque `vitest.e2e.config.mts` ya inyecta
 * `DATABASE_URL` con `test.env`.
 */
process.env.DATABASE_URL = testUrl();
