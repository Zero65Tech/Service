const assert = require('assert');

exports.init = async (config) => {

  let https = require('https');
  let httpsAgent = new https.Agent({ keepAlive: true, maxSockets: Infinity });

  let doRequest = async (client, options, req, res) => {

    options.agent = httpsAgent;
    options.headers = {
      'User-Agent': process.env.STAGE + '/' + (process.env.K_REVISION || process.env.USER || process.env.HOSTNAME)
    };

    if(req && res) {
      if(req.headers['if-none-match'])
        options.headers['If-None-Match'] = req.headers['if-none-match'];
      options.responseType = 'stream';
      options.validateStatus = status => true;
      let response = await client.request(options);
      response.data.pipe(res.status(response.status).set(response.headers));  
    } else {
      let response = await client.request(options);
      return response.data;
    }

  }

  // https://www.npmjs.com/package/google-auth-library

  let session = undefined;
  let auth = undefined;

  if(process.env.STAGE == 'alpha' || process.env.STAGE == 'gamma') {

    let fs = require('fs');
    if(fs.existsSync(process.cwd() + '/.session'))
      session = JSON.parse(await fs.promises.readFile(process.cwd() + '/.session'));

  } else if(process.env.PLATFORM == 'GCP' && process.env.ENV == 'run') {

    let { GoogleAuth } = require('google-auth-library');
    auth = new GoogleAuth();

  } else if(process.env.PLATFORM == 'GCP' && process.env.ENV == 'build') {

    let { GoogleAuth, Impersonated } = require('google-auth-library');
    auth = new Impersonated({
      sourceClient: await (new GoogleAuth()).getClient(),
      targetPrincipal: process.env.GOOGLE_SERVICE_ACCOUNT,
      targetScopes: [],
      lifetime: 3600, // 1hr
    });

  } else {

    assert.fail('Unexpected Case - STAGE:${ process.env.STAGE }  ENV:${ process.env.ENV } !');

  }

  // https://github.com/googleapis/gaxios/blob/main/README.md

  let gaxios = require('gaxios');

  for(let service in config) {

    let { baseURL, apis, params } = config[service];

    let client = undefined;

    if(process.env.STAGE == 'alpha' || process.env.STAGE == 'gamma') {

      client = session ? new gaxios.Gaxios({
        headers: { 'Cookie': 'sessionId=' + session.id }
      }) : gaxios;

    } else if(process.env.PLATFORM == 'GCP' && process.env.ENV == 'run') {

      client = await auth.getIdTokenClient(baseURL);

    } else if(process.env.PLATFORM == 'GCP' && process.env.ENV == 'build') {

      client = new gaxios.Gaxios({
        headers: { 'Authorization': 'Bearer ' + await auth.fetchIdToken(baseURL) }
      });

    }

    exports[service] = {};

    if(apis) {
      for(let api in apis) {
        let { method, path } = apis[api];
        exports[service][api] = async (data, req, res) => {
          // console.log(`${ method }: ${ baseURL }${ path } ${ JSON.stringify(data) }`);
          let options = { url: baseURL + path, method };
          if(method == 'GET')
            options.params = data;
          else if(method == 'POST')
            options.data = data;
          return await doRequest(client, options, req, res);
        };
      }
    } else {
      exports[service].pipe = async (req, res) => {
        // console.log(`${ req.method }: ${ baseURL }${ req.path } ${ JSON.stringify(req.query || req.body) }`);
        let options = { url: baseURL + req.path, method: req.method };
        if(req.method == 'GET')
          options.params = req.query;
        else if(req.method == 'POST')
          options.data = req.body;
        return await doRequest(client, options, req, res);
      };
    }

  }

  delete exports.init;

}
