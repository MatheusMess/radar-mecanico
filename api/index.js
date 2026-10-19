import { erro } from '../lib/http.js';

/**
 * Roteador unico da API.
 *
 * O plano Hobby da Vercel permite no maximo 12 funcoes serverless por deploy.
 * Com 22 endpoints, cada um em seu proprio arquivo, o build estourava o limite.
 * Aqui todos os handlers vivem em handlers/ e este arquivo so roteia.
 *
 * A URL chega como /api/login, /api/vehicles, etc. O nome do endpoint e o
 * segundo segmento do caminho.
 */
import adminUsers from '../handlers/admin-users.js';
import especialidades from '../handlers/especialidades.js';
import image from '../handlers/image.js';
import login from '../handlers/login.js';
import logout from '../handlers/logout.js';
import password from '../handlers/password.js';
import profile from '../handlers/profile.js';
import quote from '../handlers/quote.js';
import register from '../handlers/register.js';
import requestImages from '../handlers/request-images.js';
import requests from '../handlers/requests.js';
import requestStatus from '../handlers/request-status.js';
import requestUpload from '../handlers/request-upload.js';
import reviews from '../handlers/reviews.js';
import session from '../handlers/session.js';
import vehicleDelete from '../handlers/vehicle-delete.js';
import vehicleImages from '../handlers/vehicle-images.js';
import vehicleUpload from '../handlers/vehicle-upload.js';
import vehicles from '../handlers/vehicles.js';
import workshop from '../handlers/workshop.js';
import workshopPhoto from '../handlers/workshop-photo.js';
import workshops from '../handlers/workshops.js';

const ROTAS = {
  'admin-users': adminUsers,
  'especialidades': especialidades,
  'image': image,
  'login': login,
  'logout': logout,
  'password': password,
  'profile': profile,
  'quote': quote,
  'register': register,
  'request-images': requestImages,
  'requests': requests,
  'request-status': requestStatus,
  'request-upload': requestUpload,
  'reviews': reviews,
  'session': session,
  'vehicle-delete': vehicleDelete,
  'vehicle-images': vehicleImages,
  'vehicle-upload': vehicleUpload,
  'vehicles': vehicles,
  'workshop': workshop,
  'workshop-photo': workshopPhoto,
  'workshops': workshops,
};

// O maior limite de corpo entre os handlers e 5 MB (uploads de foto).
export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
  const caminho = (req.url || '').split('?')[0];
  const partes = caminho.split('/').filter(Boolean);
  const endpoint = partes[1];

  const fn = ROTAS[endpoint];
  if (!fn) {
    return res.status(404).json({ error: `Endpoint inexistente: ${endpoint}` });
  }

  return fn(req, res);
}
