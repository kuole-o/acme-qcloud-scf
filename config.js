module.exports = {
    isDebug: true,
    email: 'guole.fun@qq.com',  // 你的邮箱
    domain: 'guole.fun', // 需要生成证书的根域名，最终生成通配符证书
    qcloudSecretId: process.env.Tcb_SecretId, // 腾讯云 SecretId, https://console.cloud.tencent.com/cam/capi
    qcloudSecretKey: process.env.Tcb_SecretKey, // 腾讯云 SecretKey
    dnspodServer: 'dnspod.cn', // 国内版用 dnspod.cn（默认），国际版用 dnspod.com
    dnspodToken: process.env.Tcb_DnspodToken, // 在 https://console.dnspod.cn/account/token/token 生成，合在一块用, 隔开
    wecomWebHook: process.env.WeComWebHook, // 企业微信机器人通知 webhook
}
