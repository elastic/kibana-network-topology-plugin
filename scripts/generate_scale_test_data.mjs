#!/usr/bin/env node
/**
 * Large-scale SNMP topology generator: 1000 nodes with BGP/OSPF/ARP interconnections
 * Usage: node scripts/generate_scale_test_data.mjs [ES_HOST] [USER] [PASSWORD]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const ES=process.argv[2]||'https://localhost:9200';
const U=process.argv[3]||'elastic';
const P=process.argv[4]||'09ed4afed47fd7533d9eef6438cefd81cdde512b306304d55dec0e35e77f9f8d';
const IDX='logs-snmp.topology-default';
const AUTH=Buffer.from(`${U}:${P}`).toString('base64');

// Helpers
const rMac=()=>{const h=()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0');return`${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`};
const rIp=(octet1,octet2,octet3)=>`${octet1}.${octet2}.${octet3}.${Math.floor(Math.random()*254)+1}`;
const pick=(arr)=>arr[Math.floor(Math.random()*arr.length)];
const IFS={router:['Gi0/0/0','Gi0/0/1','Gi0/0/2','Te0/0/0/0','Lo0','Mgmt0'],switch:['Eth1/1','Eth1/2','Eth1/3','Eth1/4','Eth1/5','Eth1/6','Vlan1'],firewall:['eth1/1','eth1/2','eth1/3','eth1/4','Mgmt'],server:['eth0','eth1'],ap:['eth0','wlan0']};
const SPEEDS={router:1e10,switch:1e9,firewall:1e10,server:1e9,ap:1e8};
const VENDORS=['Cisco','Juniper','Arista','Fortinet','Palo Alto','HPE'];
const DEVICE_TYPES=['router','switch','firewall','server'];

// Generate 1000 devices across 10 sites
console.log('=== Generating 1000-node SNMP topology ===');
const sites=[];
const SITES_COUNT=10;
const DEVICES_PER_SITE=100;
let globalDeviceId=0;

for(let s=0;s<SITES_COUNT;s++){
  const siteName=`Region-${String.fromCharCode(65+s)}`; // Region-A, Region-B, ...
  const siteDevices=[];
  const siteSubnet=`10.${s}`;

  for(let d=0;d<DEVICES_PER_SITE;d++){
    const type=pick(DEVICE_TYPES);
    const vendor=pick(VENDORS);
    const device={
      id:globalDeviceId++,
      name:`${siteName.toLowerCase()}-${type}-${d.toString().padStart(3,'0')}`,
      type,
      role:d<5?'core':d<20?'distribution':'access',
      vendor,
      ip:rIp(10,s,d),
      mac:rMac(),
      site:siteName,
      building:d%5===0?'Building-A':'Building-B',
      descr:`${vendor} ${type} device ${d}`
    };
    siteDevices.push(device);
  }
  sites.push({name:siteName,subnet:siteSubnet,devices:siteDevices});
}

const allDevices=sites.flatMap(s=>s.devices);
const deviceById=new Map(allDevices.map(d=>[d.id,d]));
console.log(`Generated ${allDevices.length} devices across ${sites.length} sites`);

async function bulk(docs){
  const body=docs.flatMap(d=>[{create:{_index:IDX}},d]);
  const r=await fetch(`${ES}/_bulk`,{
    method:'POST',
    headers:{'Content-Type':'application/x-ndjson',Authorization:`Basic ${AUTH}`},
    body:body.map(l=>JSON.stringify(l)).join('\n')+'\n'
  });
  const j=await r.json();
  if(j.errors){
    const e=j.items.find(i=>i.create?.error);
    if(e)console.error('Bulk error:',JSON.stringify(e.create.error));
  }
  return j.items.length;
}

async function main(){
  const now=new Date();
  const docs=[];

  // ── Interface metrics (5 time windows) ──
  console.log('Generating interface metrics...');
  for(let t=0;t<5;t++){
    const ts=new Date(now.getTime()-t*6e4).toISOString();
    for(const d of allDevices){
      const ifs=IFS[d.type]||['eth0'];
      for(let i=0;i<ifs.length;i++){
        // Inject ~5% degraded interface links to make topology interesting
        const down=Math.random()<0.05;
        docs.push({
          '@timestamp':ts,
          host:{name:d.name,ip:d.ip,mac:d.mac,type:d.type},
          observer:{vendor:d.vendor,sys_descr:d.descr},
          network:{site:d.site,building:d.building,role:d.role},
          interface:{
            name:ifs[i],
            id:String(i+1),
            speed:SPEEDS[d.type]||1e9,
            status:{admin:'up',oper:down?'down':'up'},
            traffic:{in:{bytes:Math.floor(Math.random()*5e8)+1e6},out:{bytes:Math.floor(Math.random()*3e8)+5e5}},
            errors:{in:down?Math.floor(Math.random()*50):0,out:down?Math.floor(Math.random()*30):0}
          }
        });
      }
    }
  }

  // ── ARP table entries (current timestamp) ──
  // Within-site links + cross-site WAN links
  console.log('Generating ARP entries...');
  const ts=now.toISOString();

  // Within-site links: each site router connects to switches, switches to servers
  for(const site of sites){
    const routers=site.devices.filter(d=>d.type==='router');
    const switches=site.devices.filter(d=>d.type==='switch');
    const servers=site.devices.filter(d=>d.type==='server');

    // Router→Switch links
    for(const r of routers){
      for(const sw of switches.slice(0,Math.min(3,switches.length))){
        docs.push({
          '@timestamp':ts,
          host:{name:r.name,ip:r.ip,mac:r.mac,type:r.type},
          observer:{vendor:r.vendor,sys_descr:r.descr},
          network:{site:r.site,building:r.building,role:r.role},
          arp:{ip_addr:sw.ip,mac_addr:sw.mac,interface_index:1}
        });
        docs.push({
          '@timestamp':ts,
          host:{name:sw.name,ip:sw.ip,mac:sw.mac,type:sw.type},
          observer:{vendor:sw.vendor,sys_descr:sw.descr},
          network:{site:sw.site,building:sw.building,role:sw.role},
          arp:{ip_addr:r.ip,mac_addr:r.mac,interface_index:1}
        });
      }
    }

    // Switch→Server links
    for(const sw of switches){
      for(const srv of servers.slice(0,Math.min(5,servers.length))){
        docs.push({
          '@timestamp':ts,
          host:{name:sw.name,ip:sw.ip,mac:sw.mac,type:sw.type},
          observer:{vendor:sw.vendor,sys_descr:sw.descr},
          network:{site:sw.site,building:sw.building,role:sw.role},
          arp:{ip_addr:srv.ip,mac_addr:srv.mac,interface_index:2}
        });
        docs.push({
          '@timestamp':ts,
          host:{name:srv.name,ip:srv.ip,mac:srv.mac,type:srv.type},
          observer:{vendor:srv.vendor,sys_descr:srv.descr},
          network:{site:srv.site,building:srv.building,role:srv.role},
          arp:{ip_addr:sw.ip,mac_addr:sw.mac,interface_index:1}
        });
      }
    }
  }

  // Cross-site WAN links: connect each site's router to next site's router
  console.log('Generating cross-site WAN links...');
  for(let i=0;i<sites.length;i++){
    const nextSite=sites[(i+1)%sites.length];
    const rtrA=sites[i].devices.find(d=>d.type==='router');
    const rtrB=nextSite.devices.find(d=>d.type==='router');
    if(rtrA && rtrB){
      docs.push({
        '@timestamp':ts,
        host:{name:rtrA.name,ip:rtrA.ip,mac:rtrA.mac,type:rtrA.type},
        observer:{vendor:rtrA.vendor,sys_descr:rtrA.descr},
        network:{site:rtrA.site,building:rtrA.building,role:rtrA.role},
        arp:{ip_addr:rtrB.ip,mac_addr:rtrB.mac,interface_index:2}
      });
      docs.push({
        '@timestamp':ts,
        host:{name:rtrB.name,ip:rtrB.ip,mac:rtrB.mac,type:rtrB.type},
        observer:{vendor:rtrB.vendor,sys_descr:rtrB.descr},
        network:{site:rtrB.site,building:rtrB.building,role:rtrB.role},
        arp:{ip_addr:rtrA.ip,mac_addr:rtrA.mac,interface_index:1}
      });
    }
  }

  // ── BGP peer sessions ──
  // HQ routers in iBGP mesh, branches eBGP peer with transit provider
  console.log('Generating BGP sessions...');
  const LOCAL_ASN=65000;
  const TRANSIT_ASNS=[3356,6453,174,701]; // Actual large AS numbers

  // iBGP mesh within Region-A (HQ)
  const hqRouters=sites[0].devices.filter(d=>d.type==='router');
  for(let i=0;i<hqRouters.length;i++){
    for(let j=i+1;j<Math.min(i+3,hqRouters.length);j++){
      const rA=hqRouters[i],rB=hqRouters[j];
      docs.push({
        '@timestamp':ts,
        host:{name:rA.name,ip:rA.ip,mac:rA.mac,type:rA.type},
        observer:{vendor:rA.vendor,sys_descr:rA.descr},
        network:{site:rA.site,building:rA.building,role:rA.role},
        bgp_peer:{
          remote_ip:rB.ip,remote_asn:LOCAL_ASN,local_asn:LOCAL_ASN,
          peer_state:'Established',prefixes_received:Math.floor(Math.random()*50000)+10000,
          prefixes_sent:500,uptime_seconds:Math.floor(Math.random()*2592000)+3600,
          in_updates:Math.floor(Math.random()*10000),out_updates:Math.floor(Math.random()*1000)
        }
      });
    }
  }

  // eBGP to transit providers from each site's router
  for(const site of sites){
    const rtr=site.devices.find(d=>d.type==='router');
    if(rtr){
      const asn=pick(TRANSIT_ASNS);
      const peerIp=rIp(200,0,Math.floor(Math.random()*254)+1);
      docs.push({
        '@timestamp':ts,
        host:{name:rtr.name,ip:rtr.ip,mac:rtr.mac,type:rtr.type},
        observer:{vendor:rtr.vendor,sys_descr:rtr.descr},
        network:{site:rtr.site,building:rtr.building,role:rtr.role},
        bgp_peer:{
          remote_ip:peerIp,remote_asn:asn,local_asn:LOCAL_ASN,
          peer_state:Math.random()>0.9?'Idle':'Established', // ~10% sessions down
          prefixes_received:Math.floor(Math.random()*500000)+100000,
          prefixes_sent:1000,uptime_seconds:Math.floor(Math.random()*2592000),
          in_updates:Math.floor(Math.random()*100000),out_updates:Math.floor(Math.random()*5000)
        }
      });
    }
  }

  // ── OSPF adjacencies ──
  // Within-site OSPF mesh
  console.log('Generating OSPF adjacencies...');
  for(const site of sites){
    const routers=site.devices.filter(d=>d.type==='router');
    for(let i=0;i<routers.length;i++){
      for(let j=i+1;j<Math.min(i+4,routers.length);j++){
        const rA=routers[i],rB=routers[j];
        docs.push({
          '@timestamp':ts,
          host:{name:rA.name,ip:rA.ip,mac:rA.mac,type:rA.type},
          observer:{vendor:rA.vendor,sys_descr:rA.descr},
          network:{site:rA.site,building:rA.building,role:rA.role},
          ospf_neighbor:{
            neighbor_ip:rB.ip,router_id:rB.ip,
            state:Math.random()>0.95?'Down':'Full', // ~5% down
            area_id:site.devices.indexOf(rA)<5?'0.0.0.0':'0.0.0.1',
            priority:1,dead_timer:40,retrans_count:Math.floor(Math.random()*10)
          }
        });
      }
    }
  }

  console.log(`Total docs: ${docs.length}`);

  // Bulk index in chunks
  for(let i=0;i<docs.length;i+=500){
    const chunk=docs.slice(i,i+500);
    const cnt=await bulk(chunk);
    process.stdout.write(`\r  ${Math.min(i+500,docs.length)}/${docs.length}`);
  }
  console.log('\n=== Done ===');
}

main().catch(e=>{console.error(e);process.exit(1);});
