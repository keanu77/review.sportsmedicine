import { handleApi } from '../../../server/api.mjs';
export const onRequest = ({ request, env }) => handleApi(request, env);
