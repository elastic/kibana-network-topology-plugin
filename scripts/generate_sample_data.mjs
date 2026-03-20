#!/usr/bin/env node
const ES=process.argv[2]||'http://localhost:9200',U=process.argv[3]||'elastic',P=process.argv[4]||'changeme';
const IDX='snmp-topology',AUTH=Buffer.from(`${U}:${P}`).toString('base64');
const SITES=[{name:'HQ-DC1',building:'Main',subnet:'10.1',devices:[
{name:'hq-core-rtr-01',type:'router',role:'core',vendor:'Cisco',descr:'Cisco IOS XR Software, ASR 9000 Series Router'},
{name:'hq-core-rtr-02',type:'router',role:'core',vendor:'Cisco',descr:'Cisco IOS XR Software, ASR 9000 Series Router'},
{name:'hq-fw-01',type:'firewall',role:'core',vendor:'Palo Alto',descr:'Palo Alto Networks PA-5200 Series Firewall'},
{name:'hq-dist-sw-01',type:'switch',role:'distribution',vendor:'Cisco',descr:'Cisco NX-OS, Nexus 9000 Switch'},
{name:'hq-dist-sw-02',type:'switch',role:'distribution',vendor:'Cisco',descr:'Cisco NX-OS, Nexus 9000 Switch'},
{name:'hq-access-sw-01',type:'switch',role:'access',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9200 Switch'},
{name:'hq-access-sw-02',type:'switch',role:'access',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9200 Switch'},
{name:'hq-access-sw-03',type:'switch',role:'access',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9200 Switch'},
{name:'hq-access-sw-04',type:'switch',role:'access',vendor:'Arista',descr:'Arista Networks EOS, DCS-7050 Switch'},
{name:'hq-srv-esxi-01',type:'server',role:'server',vendor:'VMware',descr:'VMware ESXi 8.0 Linux server'},
{name:'hq-srv-esxi-02',type:'server',role:'server',vendor:'VMware',descr:'VMware ESXi 8.0 Linux server'},
{name:'hq-srv-db-01',type:'server',role:'server',vendor:'Dell',descr:'Linux 5.15 Dell PowerEdge R750 server'},
{name:'hq-ap-01',type:'ap',role:'access',vendor:'Aruba',descr:'HPE Aruba AP-535 Access Point'},
{name:'hq-ap-02',type:'ap',role:'access',vendor:'Aruba',descr:'HPE Aruba AP-535 Access Point'}],
links:[[0,2],[1,2],[2,3],[2,4],[3,5],[3,6],[4,7],[4,8],[5,9],[6,10],[7,11],[5,12],[8,13],[0,1],[3,4]]},
{name:'Branch-NYC',building:'Office-A',subnet:'10.10',devices:[
{name:'nyc-rtr-01',type:'router',role:'core',vendor:'Cisco',descr:'Cisco IOS Software, ISR 4400 Series Router'},
{name:'nyc-fw-01',type:'firewall',role:'core',vendor:'Fortinet',descr:'Fortinet FortiGate-200F Firewall'},
{name:'nyc-sw-01',type:'switch',role:'distribution',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9300 Switch'},
{name:'nyc-sw-02',type:'switch',role:'access',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9200 Switch'},
{name:'nyc-sw-03',type:'switch',role:'access',vendor:'Cisco',descr:'Cisco IOS Software, Catalyst 9200 Switch'},
{name:'nyc-srv-01',type:'server',role:'server',vendor:'Dell',descr:'Linux 5.15 Dell PowerEdge R650 server'},
{name:'nyc-ap-01',type:'ap',role:'access',vendor:'Aruba',descr:'HPE Aruba AP-515 Access Point'},
{name:'nyc-ap-02',type:'ap',role:'access',vendor:'Aruba',descr:'HPE Aruba AP-515 Access Point'}],
links:[[0,1],[1,2],[2,3],[2,4],[3,5],[4,6],[4,7]]},
{name:'Branch-CHI',building:'Office-B',subnet:'10.20',devices:[
{name:'chi-rtr-01',type:'router',role:'core',vendor:'Juniper',descr:'Juniper Networks JUNOS SRX340 Router'},
{name:'chi-fw-01',type:'firewall',role:'core',vendor:'Fortinet',descr:'Fortinet FortiGate-100F Firewall'},
{name:'chi-sw-01',type:'switch',role:'distribution',vendor:'Juniper',descr:'Juniper Networks JUNOS EX4300 Switch'},
{name:'chi-sw-02',type:'switch',role:'access',vendor:'Juniper',descr:'Juniper Networks JUNOS EX2300 Switch'},
{name:'chi-srv-01',type:'server',role:'server',vendor:'HP',descr:'Linux 5.15 HP ProLiant DL380 server'},
{name:'chi-ap-01',type:'ap',role:'access',vendor:'Aruba',descr:'HPE Aruba AP-505 Access Point'}],
links:[[0,1],[1,2],[2,3],[3,4],[3,5]]}];

const rMac=()=>{const h=()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0');return`${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`};
const rIp=(s,i)=>`${s}.${Math.floor(i/254)+1}.${(i%254)+1}`;
const IFS={router:['Gi0/0/0','Gi0/0/1','Gi0/0/2','Te0/0/0/0','Lo0','Mgmt0'],switch:['Eth1/1','Eth1/2','Eth1/3','Eth1/4','Eth1/5','Eth1/6','Eth1/7','Eth1/8','Vlan1','Mgmt0'],firewall:['eth1/1','eth1/2','eth1/3','eth1/4','Mgmt'],server:['eth0','eth1','lo'],ap:['eth0','wlan0','wlan1']};
const SPD={router:1e10,switch:1e9,firewall:1e10,server:1e9,ap:1e9};
const devs=[],dIp=new Map,dMac=new Map;let gid=1;
for(const s of SITES)for(const d of s.devices){const ip=rIp(s.subnet,gid),mac=rMac();dIp.set(d.name,ip);dMac.set(d.name,mac);devs.push({...d,ip,mac,site:s.name,building:s.building});gid++;}

async function bulk(docs){const body=docs.flatMap(d=>[{index:{_index:IDX}},d]);const r=await fetch(`${ES}/_bulk`,{method:'POST',headers:{'Content-Type':'application/x-ndjson',Authorization:`Basic ${AUTH}`},body:body.map(l=>JSON.stringify(l)).join('\n')+'\n'});const j=await r.json();if(j.errors){const e=j.items.find(i=>i.index?.error);if(e)console.error('Err:',JSON.stringify(e.index.error))}return j;}

async function main(){
console.log(`=== Generating sample data: ${devs.length} devices → ${ES}/${IDX} ===`);
const now=new Date,docs=[];
for(let t=0;t<5;t++){const ts=new Date(now.getTime()-t*6e4).toISOString();
for(const d of devs){const ifs=IFS[d.type]||['eth0'];for(let i=0;i<ifs.length;i++){
const down=d.name.includes('access-sw-03')&&ifs[i]==='Eth1/4'&&t<2;
docs.push({'@timestamp':ts,host:{name:d.name,ip:d.ip,mac:d.mac,type:d.type},observer:{vendor:d.vendor,sys_descr:d.descr,os:{full:d.descr}},network:{site:d.site,building:d.building,role:d.role},interface:{name:ifs[i],id:String(i+1),speed:SPD[d.type]||1e9,status:{admin:'up',oper:down?'down':'up'},traffic:{in:{bytes:Math.floor(Math.random()*5e8)+1e6},out:{bytes:Math.floor(Math.random()*3e8)+5e5}},errors:{in:down?Math.floor(Math.random()*50):Math.floor(Math.random()*3),out:down?Math.floor(Math.random()*30):0}}});}}}
const ts=now.toISOString(),arp=[],mac=[];
for(const s of SITES){for(const[si,ti]of s.links){const sd=s.devices[si],td=s.devices[ti];
arp.push({'@timestamp':ts,host:{name:sd.name,ip:dIp.get(sd.name),mac:dMac.get(sd.name),type:sd.type},observer:{vendor:sd.vendor,sys_descr:sd.descr},network:{site:s.name,building:s.building,role:sd.role},arp:{ip_addr:dIp.get(td.name),mac_addr:dMac.get(td.name),interface_index:1}});
arp.push({'@timestamp':ts,host:{name:td.name,ip:dIp.get(td.name),mac:dMac.get(td.name),type:td.type},observer:{vendor:td.vendor,sys_descr:td.descr},network:{site:s.name,building:s.building,role:td.role},arp:{ip_addr:dIp.get(sd.name),mac_addr:dMac.get(sd.name),interface_index:1}});
if(sd.type==='switch')mac.push({'@timestamp':ts,host:{name:sd.name,ip:dIp.get(sd.name),mac:dMac.get(sd.name),type:sd.type},observer:{vendor:sd.vendor,sys_descr:sd.descr},network:{site:s.name,building:s.building,role:sd.role},mac_table:{mac_addr:dMac.get(td.name),port_index:ti+1,status:'learned'}});
if(td.type==='switch')mac.push({'@timestamp':ts,host:{name:td.name,ip:dIp.get(td.name),mac:dMac.get(td.name),type:td.type},observer:{vendor:td.vendor,sys_descr:td.descr},network:{site:s.name,building:s.building,role:td.role},mac_table:{mac_addr:dMac.get(sd.name),port_index:si+1,status:'learned'}});}}
// WAN links
const WAN=[[0,0,1,0],[0,1,2,0]];
for(const[si,sdi,ti,tdi]of WAN){const sd=SITES[si].devices[sdi],td=SITES[ti].devices[tdi];
arp.push({'@timestamp':ts,host:{name:sd.name,ip:dIp.get(sd.name),mac:dMac.get(sd.name),type:sd.type},observer:{vendor:sd.vendor,sys_descr:sd.descr},network:{site:SITES[si].name,building:SITES[si].building,role:sd.role},arp:{ip_addr:dIp.get(td.name),mac_addr:dMac.get(td.name),interface_index:2}});
arp.push({'@timestamp':ts,host:{name:td.name,ip:dIp.get(td.name),mac:dMac.get(td.name),type:td.type},observer:{vendor:td.vendor,sys_descr:td.descr},network:{site:SITES[ti].name,building:SITES[ti].building,role:td.role},arp:{ip_addr:dIp.get(sd.name),mac_addr:dMac.get(sd.name),interface_index:1}});}
const all=[...docs,...arp,...mac];console.log(`Total docs: ${all.length}`);
for(let i=0;i<all.length;i+=500){await bulk(all.slice(i,i+500));process.stdout.write(`\r  ${Math.min(i+500,all.length)}/${all.length}`);}
console.log('\n=== Done ===');
}
main().catch(e=>{console.error(e);process.exit(1);});
