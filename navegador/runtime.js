// Conecta la base de datos, Google y la API en un solo objeto que atiende llamadas "/api" sin servidor.
import { createPlanner } from '../server/services/planner.js';
import { createApi } from '../server/api.js';
import miniExpress, { crearCliente } from './mini-express.js';

export function crearRuntime({ db, google, demo = false }) {
  const planner = createPlanner({ db, google });
  const router = createApi({ db, google, planner, demo, express: miniExpress });
  return { client: crearCliente(router), planner };
}
