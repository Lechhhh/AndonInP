'use strict';
const AndonStations = Object.freeze({
    departments: Object.freeze({
        electro: Object.freeze(['y0','y1','y2','y3','y4']),
        assembly: Object.freeze(['a1','a2','a3','a4','b5','b6','b7','b8','c3','c4','c6'])
    }),
    dual: Object.freeze(['a1','a2','a3','a4','b5','b6','b8','c3','c4']),
    label(value) {
        const id=String(value??'').toLowerCase();
        if(/^y[0-4]$/.test(id))return 'X'+id.slice(1);
        if(/^[abc]\d$/.test(id))return id.toUpperCase();
        return String(value??'').toUpperCase();
    },
    department(value){const id=String(value??'').toLowerCase();return this.departments.electro.includes(id)?'electro':this.departments.assembly.includes(id)?'assembly':null;},
    supportsSecond(value){return this.dual.includes(String(value??'').toLowerCase());},
    ids(){return [...this.departments.electro,...this.departments.assembly];}
});
if(typeof module!=='undefined'&&module.exports)module.exports=AndonStations;
