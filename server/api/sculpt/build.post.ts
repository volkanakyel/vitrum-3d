import { buildCore } from '../../utils/sculpt/routes'
import { runSculptRoute } from '../../utils/sculpt/handler'

export default defineEventHandler(event => runSculptRoute(event, buildCore))
