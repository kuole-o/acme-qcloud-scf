/**
 * acme-qcloud-scf
 * @author Jeff2Ma
 * @url https://github.com/Jeff2Ma/acme-qcloud-scf
 */

let isScfEnv = false; // 是否是云函数环境
const moment = require('moment');
const acme = require('acme-client');
const tencentcloud = require("tencentcloud-sdk-nodejs");
const token = process.env.token;
const axios = require('axios');
const appName = '[acme-qcloud-scf]';

acme.setLogger((message) => {
  console.log(message);
});

// 读取配置文件
let config = {};
try {
  config = require('./config.js')
} catch (e) {
  console.log(e);
}

function log() {
  const args = [];
  args.push(appName);
  for (let i = 0; i < arguments.length; i++) {
    args.push(arguments[i]);
  }
  console.log.apply(console, args);
}

// dnspod 实例
const DnspodApi = require('dnspod-api');
const dnspodApi = new DnspodApi({
  server: config.dnspodServer || 'dnspod.cn',
  token: config.dnspodToken // your login token, you can find how to get this at the top.
});

const sslClient = new tencentcloud.ssl.v20191205.Client({
  credential: {
    secretId: config.qcloudSecretId,
    secretKey: config.qcloudSecretKey,
  },
  // region: "ap-shanghai",
  profile: {
    signMethod: "TC3-HMAC-SHA256",
    httpProfile: {
      reqMethod: "POST",
      reqTimeout: 30,
      endpoint: "ssl.tencentcloudapi.com",
    },
  },
})

const cdnClient = new tencentcloud.cdn.v20180606.Client({
  credential: {
    secretId: config.qcloudSecretId,
    secretKey: config.qcloudSecretKey,
  },
  profile: {
    signMethod: "TC3-HMAC-SHA256",
    httpProfile: {
      reqMethod: "POST",
      reqTimeout: 30,
      endpoint: "cdn.tencentcloudapi.com",
    },
  },
})

async function cdnList() {
  const params = {};
  try {
    const data = await cdnClient.DescribeDomains(params);
    if (data && data.Domains) {
      const domainArray = data.Domains.map((domainInfo) => domainInfo.Domain);
      console.log(domainArray);
      return domainArray;
    } else {
      console.error("Error: Unable to retrieve domain data");
      return [];
    }
  } catch (err) {
    console.error("error", err);
    return [];
  }
}

const webHookUrl = config?.wecomWebHook || ''; // 暂时不用

async function challengeCreateFn(authz, challenge, keyAuthorization) {
  const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
  const recordValue = keyAuthorization;
  log(`Creating TXT record for ${authz.identifier.value}: ${dnsRecord}`);
  // 清空所有的 DNS 记录
  await removeOldDNSRecords('firstTime');
  const createRes = await dnspodApi.do({
    action: 'Record.Create',
    params: {
      domain: config.domain,
      sub_domain: '_acme-challenge',
      record_line: '默认',
      mx: '1',
      record_type: 'TXT',
      value: recordValue
    }
  })
  log('createRes', createRes.status)
  return createRes
}

async function challengeRemoveFn(authz, challenge, keyAuthorization) {
  const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
  const recordValue = keyAuthorization;
  log(`Removing TXT record for ${authz.identifier.value}: ${dnsRecord}`);
  const recordListData = await dnspodApi.do({
    action: 'Record.List',
    params: {
      domain: config.domain,
      sub_domain: '_acme-challenge',
    }
  }).catch((e) => {
    log(e)
    return {}
  })
  log('challengeRemoveFn:recordListData', recordListData.status)
  //   status: { code: '10', message: '记录列表为空', created_at: '2022-05-01 11:23:49' },
  if (recordListData?.status?.code + '' === '10') {
    log('删除 dns 记录，已为空')
    return {}
  } else {
    const records = recordListData?.records;
    // log('records', records)
    const record = records.find(item => item.value === dnsRecord)
    const res = await dnspodApi.do({
      action: 'Record.Remove',
      params: {
        domain: config.domain,
        sub_domain: '_acme-challenge',
        record_line: '默认',
        mx: '1',
        record_id: record.id,
        record_type: 'TXT',
        // value: recordValue
      }
    })
    log('Record.Remove Success:', res.status);
    return {}
  }
}

async function removeOldDNSRecords(from = '') {
  // https://docs.dnspod.cn/api/modify-records/
  const recordListData = await dnspodApi.do({
    action: 'Record.List',
    params: {
      domain: config.domain,
      sub_domain: '_acme-challenge',
    }
  }).catch((e) => {
    log(e)
    return {}
  })
  log('removeOldDNSRecords:recordListData', recordListData.status);
  if (recordListData?.status?.code + '' === '10') {
    return Promise.resolve({
      empty: true,
      length: 0,
    });
  }
  const records = recordListData?.records;
  if (records.length) {
    log('提示：检测到有旧的 dns 记录，尝试全部删除');
    await Promise.all(records.map(async item => {
      const res = await dnspodApi.do({
        action: 'Record.Remove',
        params: {
          domain: config.domain,
          sub_domain: '_acme-challenge',
          record_line: '默认',
          mx: '1',
          record_id: item.id,
          record_type: 'TXT',
          // value: recordValue
        }
      })
      log(`Record.Remove Success:${item.id}`, res.status)
    }))

    if (from && from === 'firstTime') {
      log('延迟 15s，预防 dns 缓存因素影响');
      await sleep(15);
    }

    return {}
  }
  return Promise.resolve({
    empty: true,
    length: 0,
  });
}

async function sleep(s) {
  return new Promise(resolve => setTimeout(resolve, s * 1000));
}

async function uploadCert2QcloudSSL(cert, key) {
  // 腾讯云 SDK
  log('正在上传到腾讯云 SSL 管理...');

  // 待删除旧的
  const { TotalCount, Certificates } = await sslClient.DescribeCertificates(
    {
      SearchKey: config.domain
    }
  ).catch(() => {
  })

  if (TotalCount && Certificates.length) {
    await Promise.all(Certificates.map(async (item, index) => {
      await new Promise(resolve => setTimeout(resolve, index * 300));

      await sslClient.DeleteCertificate({
        CertificateId: item.CertificateId
      });
      log(`正在删除${item.CertificateId}, ${item.Domain} 证书`);
    }));
  }

  const uploadCertificateRes = await sslClient.UploadCertificate({
    CertificatePublicKey: cert.toString(),
    CertificatePrivateKey: key.toString(),
    Alias: config.domain
  }).catch((e) => {
    console.error(e);
  });
  log('上传本次产生的证书: ', uploadCertificateRes);
  return uploadCertificateRes;
}

async function initConfig(config, env) {
  let envFormat = {};
  if (env && typeof env === 'string') {
    try {
      envFormat = JSON.parse(env)
    } catch (e) {
    }
  }
  return Object.assign({}, config, envFormat)
}

async function updateCDNDomains(cert, key, CertificateId) {
  const nowStr = moment(new Date()).utcOffset(8).format('YYYY-MM-DD HH:mm:ss');
  const list = await cdnList();
  if (!list || !list.length) return Promise.resolve({})
  try {
    await Promise.all(list.map(async item => {
      log(`正在为如下 cdn 域名进行 https 证书绑定：${item}, ${CertificateId}`)
      await cdnClient.UpdateDomainConfig({
        Domain: item,
        Https: {
          Switch: 'on',
          CertInfo: {
            CertId: CertificateId,
            Message: `${appName}${nowStr}`,
          }
        }
      }).then(
        (data) => {
          log(data);
        },
        (err) => {
          console.error("error", err);
        }
      );
    }))
    return list
  } catch (err) {
    console.error("error", err);
  }
}

async function postWeComRobotMsg(options) {
  const content = options?.content || ''
  if (!content) return '没有消息要发送';
  const postData = {
    "msgtype": "text",
    "text": {
      content: (!isScfEnv ? '[本地调试发送]' : '') + content
    }, "mentioned_list": ["@all"]
  };
  return axios.post(config.wecomWebHook, postData)
    .then(function (res) {
      console.log(res.data);
      return res.data;
    })
    .catch(function (error) {
      console.log(error);
      return 'st wrong when post qywx robot api';
    })
    .then(function (result) {
      return '发送企业微信机器人成功:' + JSON.stringify(result) + 'H:' + moment().utcOffset(8).format('kk');
    });
}

const main_handler = async (event, context = {}, callback) => {
  const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod, MsgId } = event;

  // 简单鉴权
  const request_token =
    (headers && headers.token) ||
    (queryString && queryString.token) ||
    (event && event.token) ||
    "";
  if (request_token !== token) return {
    "isBase64Encoded": false,
    "statusCode": 401,
    "headers": { "Content-Type": "text/plain; charset=utf-8" },
    "body": "Unauthorized",
  }

  const environment = context?.environment || {}
  config = await initConfig(config, environment);

  // 处理函数定时激活
  const isScfActivation = (queryString && queryString.auto) || (event && event.auto) || false;
  if (isScfActivation) {
    return {
      "isBase64Encoded": false,
      "statusCode": 200,
      "headers": { "Content-Type": "text/plain; charset=utf-8" },
      "body": "Success 触发云函数成功！"
    }
  }

  // 云函数环境特有
  if (config['SCF_NAMESPACE']) {
    isScfEnv = true
  }
  log('isScfEnv', isScfEnv)

  /* Init client */
  const client = new acme.Client({
    directoryUrl: (!isScfEnv || +(config.isDebug)) ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey: await acme.forge.createPrivateKey(),
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
  });

  /* Register account */
  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: [`mailto:${config.email}`]
  });

  /* Place new order */
  const order = await client.createOrder({
    wildcard: true,
    identifiers: [
      { type: 'dns', value: `${config.domain}` },
      { type: 'dns', value: `*.${config.domain}` }
    ]
  });

  /**
   * authorizations / client.getAuthorizations(order);
   * An array with one item per DNS name in the certificate order.
   * All items require at least one satisfied challenge before order can be completed.
   */

  const authorizations = await client.getAuthorizations(order);

  const promises = authorizations.map(async (authz) => {
    let challengeCompleted = false;

    try {
      /**
       * challenges / authz.challenges
       * An array of all available challenge types for a single DNS name.
       * One of these challenges needs to be satisfied.
       */

      const { challenges } = authz;

      /* Just select Dns Way */
      const challenge = challenges.find(c => c.type === 'dns-01');

      const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

      try {
        /* Satisfy challenge */
        await challengeCreateFn(authz, challenge, keyAuthorization);

        log('延迟 15s，预防 dns 缓存因素影响');
        await sleep(15);

        /* Verify that challenge is satisfied */
        await client.verifyChallenge(authz, challenge);

        /* Notify ACME provider that challenge is satisfied */
        await client.completeChallenge(challenge);
        challengeCompleted = true;

        /* Wait for ACME provider to respond with valid status */
        await client.waitForValidStatus(challenge);
      } finally {
        /* Clean up challenge response */
        try {
          // await challengeRemoveFn(authz, challenge, keyAuthorization);
        } catch (e) {
          /**
           * Catch errors thrown by challengeRemoveFn() so the order can
           * be finalized, even though something went wrong during cleanup
           */
        }
      }
    } catch (e) {
      /* Deactivate pending authz when unable to complete challenge */
      if (!challengeCompleted) {
        try {
          await client.deactivateAuthorization(authz);
        } catch (f) {
          /* Catch and suppress deactivateAuthorization() errors */
        }
      }

      throw e;
    }
  });

  /* Wait for challenges to complete */
  await Promise.all(promises);

  try {
    /* Finalize order */
    const [key, csr] = await acme.forge.createCsr({
      commonName: `*.${config.domain}`,
      altNames: [`${config.domain}`]
      // commonName: `${config.domain}`,//  建议用根域名
      // altNames: [`${config.domain}`, `*.${config.domain}`]
    });

    const finalized = await client.finalizeOrder(order, csr);
    const cert = await client.getCertificate(finalized);

    /* 完成 */
    log(`CSR:\n${csr.toString()}`);
    log(`Private key:\n${key.toString()}`);
    log(`Certificate:\n${cert.toString()}`);
    const { CertificateId } = await uploadCert2QcloudSSL(cert, key);
    const list = await updateCDNDomains(cert, key, CertificateId);
    const formattedList = list.join('\n');
    await postWeComRobotMsg({
      content: `SSL 证书已更新！\n\n证书ID：${CertificateId}\n更新域名：\n${formattedList}`
    })
  } catch (e) {
    log('Finalize order error: ', e)
    await postWeComRobotMsg({
      content: `生成证书失败${JSON.parse(JSON.stringify(e))}`
    })
  }
  // 清空多余的 dnsPod 记录
  await removeOldDNSRecords()
};

// 调试
const main_handler_bak = async (event, context = {}, callback) => {
  try {
    const params = {};
    const data = await cdnClient.DescribeDomains(params);
    const domainArray = data.Domains.map((domainInfo) => domainInfo.Domain);
    console.log(domainArray);
    return domainArray;
  } catch (err) {
    console.error("error", err);
    return err;
  }
}

exports.main_handler = main_handler