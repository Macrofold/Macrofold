import {auth} from '@platform/core/auth';
export const GET=async()=>Response.json(await auth.api.getOpenIdConfig());
