'use strict'

const express = require("express");
const { collectDefaultMetrics, Gauge, register } = require("prom-client");
const Client = require('kubernetes-client').Client;
const config = require('kubernetes-client').config;
const client = new Client({ config: config.fromKubeconfig(), version: '1.9' });

const app = express()
const port = process.env.PORT || 5000
const metricsInterval = collectDefaultMetrics()
const gauge = new Gauge({
    name: 'k8s_external_resource',
    help: 'The kubernetes external resource (service or ingress) metric',
    labelNames: ['name',"namespace",'external_ip','type','ip_filter']
})

app.get('/metrics', async (req: any, res: any) => {
    try {
        const namespaces = await client.api.v1.namespaces.get();
        if (namespaces.statusCode === 200){
            namespaces.body.items.forEach(async (item: any) => {
                const namespace = item.metadata.name;
                const services = await client.api.v1.namespaces(namespace).services.get();
                if (services.statusCode === 200) {
                    services.body.items.forEach((service: any) => {
                        const name = service.metadata.name;
                        const type = service.spec.type;
                        const external_ip = service.status.loadBalancer.ingress ? service.status.loadBalancer.ingress[0] : ""
                        const ip_filter = service.spec.loadBalancerSourceRanges ? service.spec.loadBalancerSourceRanges.join(",") : "";
                        gauge.labels(name, namespace, external_ip, type, ip_filter).set(1);
                    });
                }
                const ingresses = await client.apis.extensions.v1beta1.namespaces(namespace).ingresses.get();
                if (ingresses.statusCode === 200) {
                    ingresses.body.items.forEach((ingress: any) => {
                        const name = ingress.metadata.name;
                        const external_ip = ingress.status.loadBalancer.ingress ? ingress.status.loadBalancer.ingress[0] : ""
                        const ip_filter = ingress.annotations ? ingress.annotations['ingress.kubernetes.io/whitelist-source-range'] : "";
                        gauge.labels(name, namespace, external_ip, 'ingress', ip_filter).set(1);
                    });
                }
            });
        }
        res.set('Content-Type', register.contentType)
        res.end(register.metrics())
    } catch(e) {
        res.status(503).json({error: e.toString()});
    }
})

const server = app.listen(port, () => {
    console.log(`Exporter listening on port ${port}!`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
    clearInterval(metricsInterval)

    server.close((err: any) => {
        if (err) {
            console.error(err)
            process.exit(1)
        }

        process.exit(0)
    })
})