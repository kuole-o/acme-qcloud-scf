module.exports = {
    isDebug: true, // 验证完成后，此项必须配置为 false，否则申请的是测试证书，浏览器会报错“无效证书”
    email: process.env.Email,  // 你的邮箱
    domain: process.env.Domain, // 需要生成证书的根域名，最终生成通配符证书
    qcloudSecretId: process.env.Tcb_SecretId, // 腾讯云 SecretId, https://console.cloud.tencent.com/cam/capi
    qcloudSecretKey: process.env.Tcb_SecretKey, // 腾讯云 SecretKey
    dnspodServer: 'dnspod.cn', // 国内版用 dnspod.cn（默认），国际版用 dnspod.com
    dnspodToken: process.env.Tcb_DnspodToken, // 在 https://console.dnspod.cn/account/token/token 生成，合在一块用, 隔开
    wecomWebHook: process.env.WeComWebHook, // 企业微信机器人通知 webhook
}
