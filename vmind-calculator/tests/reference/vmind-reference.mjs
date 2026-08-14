// ==========================================================================
// OTOMATIK URETILDI - ELLE DUZENLEME
// Kaynak: https://calculator.portvmind.com/assets/index-DsenZ_4u.js
// Asagidaki fonksiyon govdeleri platformun uretim bundle'indan VERBATIM
// kopyalanmistir (minified degisken adlari dahil). Tek amaci: src/core/pricing
// icindeki temiz portu bu referansa karsi differential test etmek.
// Elle duzeltmeyin - sapma tespit etmek icin bozulmamis kalmasi gerekir.
// ==========================================================================
/* eslint-disable */
const services = [
  {
    "code": "compute",
    "title": "Compute"
  },
  {
    "code": "storage",
    "title": "Block Storage"
  },
  {
    "code": "data-transfer",
    "title": "Network Data Transfer"
  },
  {
    "code": "floating-ip",
    "title": "Floating IP"
  },
  {
    "code": "load-balancer",
    "title": "Load Balancer"
  },
  {
    "code": "kubernetes",
    "title": "Kubernetes"
  },
  {
    "code": "object-storage",
    "title": "Object Storage"
  },
  {
    "code": "router",
    "title": "Router"
  },
  {
    "code": "backup",
    "title": "Backup"
  }
];

const Calculate=(_e,St,en,tn)=>{var An,cn;en=en??1;let nn=0,rn=0;const an=(cn=(An=_e.lookup.products.result)==null?void 0:An.items)==null?void 0:cn.find(un=>un.productCode===St);if(!an)return{hourly:nn,monthly:rn};const on=an.prices.find(un=>un.currency===_e.currency),sn=on.price;return tn&&(en*=tn=="GB"?1:1024),nn=sn*en,rn=sn*en*720,on.pricingUnit!="HOUR"&&(rn=sn*en),{productObj:an,priceObj:on,hourly:nn,monthly:rn}},blockStorageLineName=(_e,St)=>`${_e("Block Storage")} - ${St.volumeTypeName||_e("Default")}`,CalculateService=(_e,St,en,tn)=>{var An,cn,un,dn,fn,gn,hn,yn,mn,vn,bn,_n,Cn,En,Rn,Sn,Fn,On,Tn,Ln,Dn;let nn=0,rn=0;const an=[],on=[],sn=In=>{var Nn;return(Nn=services.find(Pn=>Pn.code===In))==null?void 0:Nn.title};if(en=="compute"){const In=tn,Nn=Calculate(St,In.productCode,In.count);if(an.push(`${In.count} x ${(An=Nn.productObj)==null?void 0:An.productName}`),on.push({productName:(cn=Nn.productObj)==null?void 0:cn.productName,count:In.count,hourly:Nn.hourly,monthly:Nn.monthly,flavorCode:In.productCode}),nn+=Nn.hourly,rn+=Nn.monthly,In.network){const Pn=Calculate(St,In.network.productCode,In.network.traffic,In.network.unit);rn+=Pn.monthly,an.push(`${In.network.traffic} ${In.network.unit} ${sn("data-transfer")}`),on.push({productName:_e("Data Transfer"),count:`${In.network.traffic} ${In.network.unit}`,hourly:"-",monthly:Pn.monthly,flavorCode:In.productCode})}if(In.storage){const Pn=In.count??1,jn=Calculate(St,In.storage.productCode,In.storage.size*Pn,In.storage.unit);nn+=jn.hourly,rn+=jn.monthly,an.push((Pn>1?`${Pn} instances x `:"")+`${In.storage.size} ${In.storage.unit}  ${sn("storage")}`),on.push({productName:blockStorageLineName(_e,In.storage),count:(Pn>1?`${Pn} instances x `:"")+`${In.storage.size} ${In.storage.unit}`,hourly:jn.hourly,monthly:jn.monthly,flavorCode:In.productCode})}if(In.backup){const Pn=In.count??1,jn=In.backup.estimatedCount??0;if(jn>0){const Un=Calculate(St,In.backup.productCode,Pn*In.backup.sourceSize*jn,"GB");nn+=Un.hourly,rn+=Un.monthly,an.push((Pn>1?`${Pn} instances x `:"")+`${In.backup.sourceSize} GB x ${jn}  ${sn("backup")}`),on.push({productName:_e("Backup"),count:(Pn>1?`${Pn} instances x `:"")+`${In.backup.sourceSize} GB x ${jn}  ${sn("backup")}`,hourly:Un.hourly,monthly:Un.monthly,flavorCode:In.productCode})}}if(In.floatingIp){const Pn=Calculate(St,In.floatingIp.productCode,In.floatingIp.count);nn+=Pn.hourly,rn+=Pn.monthly,an.push(`${In.floatingIp.count} ${sn("floating-ip")}`),on.push({productName:_e("Floating IP"),count:In.floatingIp.count,hourly:Pn.hourly,monthly:Pn.monthly,flavorCode:In.productCode})}if(In.router){const Pn=In.router.floatingIp;if(Pn){const Un=Calculate(St,Pn.productCode,Pn.count);nn+=Un.hourly,rn+=Un.monthly,an.push(`${Pn.count} ${sn("floating-ip")}`),on.push({productName:_e("Floating IP"),count:Pn.count,hourly:Un.hourly,monthly:Un.monthly,flavorCode:In.productCode})}const jn=In.router.network;if(jn){const Un=Calculate(St,jn.productCode,jn.traffic,jn.unit);rn+=Un.monthly,an.push(`${jn.traffic} ${jn.unit} ${sn("data-transfer")}`),on.push({productName:_e("Data Transfer"),count:`${jn.traffic} ${jn.unit}`,hourly:"-",monthly:Un.monthly,flavorCode:In.productCode})}}}else if(en=="data-transfer"){const In=tn,Nn=Calculate(St,In.productCode,In.traffic,In.unit);an.push(`${In.traffic} ${In.unit} ${sn("data-transfer")}`),rn+=Nn.monthly,on.push({productName:_e("Data Transfer"),count:`${In.traffic} ${In.unit}`,hourly:"-",monthly:Nn.monthly})}else if(en=="router"){const In=tn,Nn=In.floatingIp;if(Nn){const jn=Calculate(St,Nn.productCode,Nn.count);nn+=jn.hourly,rn+=jn.monthly,an.push(`${Nn.count} ${sn("floating-ip")}`),on.push({productName:_e("Floating IP"),count:Nn.count,hourly:jn.hourly,monthly:jn.monthly})}const Pn=In.network;if(Pn){const jn=Calculate(St,Pn.productCode,Pn.traffic,Pn.unit);rn+=jn.monthly,an.push(`${Pn.traffic} ${Pn.unit} ${sn("data-transfer")}`),on.push({productName:_e("Data Transfer"),count:`${Pn.traffic} ${Pn.unit}`,hourly:"-",monthly:jn.monthly})}}else if(en=="storage"){const In=tn,Nn=Calculate(St,In.productCode,In.size,In.unit);nn+=Nn.hourly,rn+=Nn.monthly,an.push(`${In.size} ${In.unit} ${sn("storage")}`),on.push({productName:blockStorageLineName(_e,In),count:`${In.size} ${In.unit}`,hourly:Nn.hourly,monthly:Nn.monthly})}else if(en==="backup"){const In=tn,Nn=Number(In.unit==="TB"?In.sourceSize*1024:In.sourceSize)||0,Pn=Number(In.estimatedCount)||0,jn=Nn*Pn;if(jn>0){const Un=Calculate(St,tn.productCode,jn,"GB");nn+=Un.hourly,rn+=Un.monthly,an.push(`${Pn} ${_e("Backups")} (${Math.round(jn)} GB total)`),on.push({productName:_e("Cloud Backup Service"),count:`${Pn} backups x ${Nn} ${In.unit}`,hourly:Un.hourly,monthly:Un.monthly})}}else if(en=="floating-ip"){const In=tn,Nn=Calculate(St,In.productCode,In.count);nn+=Nn.hourly,rn+=Nn.monthly,an.push(`${In.count} ${sn("floating-ip")}`),on.push({productName:_e("Floating IP"),count:In.count,hourly:Nn.hourly,monthly:Nn.monthly})}else if(en=="object-storage"){const In=tn;if(In.storage){const Nn=Calculate(St,In.storage.productCode,In.storage.size,In.storage.unit);nn+=Nn.hourly,rn+=Nn.monthly,an.push(`${In.storage.size} ${In.storage.unit} ${sn("storage")}`),on.push({productName:_e("Object Storage"),count:`${In.storage.size} ${In.storage.unit}`,hourly:Nn.hourly,monthly:Nn.monthly})}if(In.network){const Nn=Calculate(St,In.network.productCode,In.network.traffic,In.network.unit);rn+=Nn.monthly,an.push(`${In.network.traffic} ${In.network.unit} ${sn("data-transfer")}`),on.push({productName:_e("Data Transfer"),count:`${In.network.traffic} ${In.network.unit}`,hourly:"-",monthly:Nn.monthly})}}else if(en=="load-balancer"){const In=tn,Nn=Calculate(St,In.productCode);if(nn+=Nn.hourly,rn+=Nn.monthly,on.push({productName:_e("Load Balancer"),count:In.productCode=="LB-001"?"App LoadBalancer":"Net LoadBalancer",hourly:Nn.hourly,monthly:Nn.monthly}),In.network){const Pn=Calculate(St,In.network.productCode,In.network.traffic,In.network.unit);rn+=Pn.monthly,an.push(`${In.network.traffic} ${In.network.unit} ${sn("data-transfer")}`),on.push({productName:_e("Data Transfer"),count:`${In.network.traffic} ${In.network.unit}`,hourly:"-",monthly:Pn.monthly})}}else if(en=="kubernetes"){const In=tn,Nn=Calculate(St,(un=In.master)==null?void 0:un.productCode,(dn=In.master)==null?void 0:dn.count);nn+=Nn.hourly,rn+=Nn.monthly,an.push(`Master: ${(fn=Nn.productObj)==null?void 0:fn.productName}`),on.push({productName:`Master - ${(gn=Nn.productObj)==null?void 0:gn.productName}`,count:(hn=In.master)==null?void 0:hn.count,hourly:Nn.hourly,monthly:Nn.monthly,flavorCode:(yn=In.master)==null?void 0:yn.productCode});const Pn=Calculate(St,(mn=In.worker)==null?void 0:mn.productCode,(vn=In.worker)==null?void 0:vn.count);nn+=Pn.hourly,rn+=Pn.monthly,an.push(`Worker: ${(bn=In.worker)==null?void 0:bn.count} x ${(_n=Pn.productObj)==null?void 0:_n.productName}`),on.push({productName:`Worker - ${(Cn=Pn.productObj)==null?void 0:Cn.productName}`,count:(En=In.worker)==null?void 0:En.count,hourly:Pn.hourly,monthly:Pn.monthly,flavorCode:(Rn=In.worker)==null?void 0:Rn.productCode});const jn=(Sn=In.master)==null?void 0:Sn.storage;if(jn){const Gn=((Fn=In.master)==null?void 0:Fn.count)??1,Jn=Calculate(St,jn.productCode,jn.size,jn.unit);nn+=Jn.hourly*Gn,rn+=Jn.monthly*Gn,an.push(`${Gn} x ${jn.size} ${jn.unit} ${sn("storage")}`),on.push({productName:blockStorageLineName(_e,jn),count:`Master - ${Gn} instances x ${jn.size} ${jn.unit}`,hourly:Jn.hourly*Gn,monthly:Jn.monthly*Gn,flavorCode:(On=In.master)==null?void 0:On.productCode})}const Un=(Tn=In.worker)==null?void 0:Tn.storage;if(Un){const Gn=((Ln=In.worker)==null?void 0:Ln.count)??1,Jn=Calculate(St,Un.productCode,Un.size,Un.unit);nn+=Jn.hourly*Gn,rn+=Jn.monthly*Gn,an.push(`${Gn} x ${Un.size} ${Un.unit} ${sn("storage")}`),on.push({productName:blockStorageLineName(_e,Un),count:`Worker - ${Gn} instances x ${Un.size} ${Un.unit}`,hourly:Jn.hourly*Gn,monthly:Jn.monthly*Gn,flavorCode:(Dn=In.worker)==null?void 0:Dn.productCode})}}return{totalHourCost:nn,totalMonthCost:rn,summary:an,lines:on}},ServiceTotals=(_e,St,en,tn)=>{const nn=[];let rn=0,an=0;if(!en||!tn)St.list.length&&St.list.forEach(on=>{const sn=CalculateService(_e,St,on.service,on.data);rn+=sn.totalHourCost,an+=sn.totalMonthCost,sn.lines.forEach(An=>{An.service=on.service}),nn.push(...sn.lines)});else{const on=CalculateService(_e,St,en,tn);rn=on.totalHourCost,an=on.totalMonthCost,nn.push(...on.lines)}return{lines:nn,totalHourCost:rn,totalMonthCost:an}};

export { Calculate, CalculateService, ServiceTotals, services };
