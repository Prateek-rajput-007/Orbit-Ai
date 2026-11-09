import proxy from 'express-http-proxy';
const proxyWithHeader = (targetUrl) => {
    return proxy(targetUrl, {
        proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
            // Add the Authorization header from the original request to the proxied request
            if (srcReq.headers['authorization']) {
            proxyReqOpts.headers['x-user-id'] = srcReq.headers['authorization'] || '';
            }
            return proxyReqOpts;
        }
    });
}
export default proxyWithHeader;