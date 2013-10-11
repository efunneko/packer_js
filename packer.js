//
// packer.js - a method for efficiently binary packing and unpacking JSON
// 
// This is for situations where there is communication between two environments that 
// support this packing protocol and where every byte counts and when gzip is not
// readily available
//
// Copyright (c) 2013 Edward Funnekotter 
// jquery.semp is currently available for use in all personal or commercial projects 
// under the MIT license (http://opensource.org/licenses/MIT).
// 
//



"use strict";

(function(ctx) {

    var packer = function() {
        this.typeCount = 0;
        this.types   = {};
        this.typeArr = [];

        this.typedef = function(typeData) {

            if (!typeData.name) error("Missing 'name' in type definition");

            this._storeType(typeData.name, this._learnType(typeData), typeData.typeCode);

        };

        // Can be called by a user if he/she wants to reserve some type values to
        // hard-code encoding values for the types
        this.reserveTypeVals = function(num) {
            var starting = this.typeCount; 
            this.typeCount += num;
            return starting;
        }

        this.pack = function(typeName, data) {
            if (!this.types[typeName]) { error("Can't pack structure with type '"+ typeName + "'"); }

            var typeObj = this.types[typeName].typeObj;
            if (!this.packFuncs[typeObj.type]) { error("Bad packing type: " + typeObj.type); }
            var buf = this.packFuncs[typeObj.type].call(this, data, typeObj);
            return buf;
        };

        this.unpack = function(data) {
            return (this._unpackTlv(data.toArray()))[0];
        };

        // Private members
        this._storeType = function(name, typeObj, typeCode) {
            if (typeof(typeCode) == "undefined") {
                typeCode = this.typeCount++;
            }
            if (!typeObj.name) {
                typeObj.name = name;
            }
            var entry = {typeCode: typeCode,
                         name:     name,
                         typeObj:  typeObj};
            this.typeArr[typeCode] = entry;
            this.types[name]  = entry;
        }


        this._learnType = function(data) {

            var typeObj = {
                name:   data.name
            };

            if (typeof(data) == "string") {
                // Simple reference to another defined type
                if (!this.types[data]) {
                    error("Unknown data type '" + data + "' for item '" + name + "'");
                }
                return this.types[data].typeObj;
            }

            if (!this.types[data.type]) {
                error("Unexpected type '" + data.type + "' for item '" + name + "'");
            }
            
            typeObj.type = this.types[data.type].typeObj.type;

            if (data.type == "enum") {
                if (!data.items) { error("Missing 'items' field in data type " + name); }
                typeObj.itemMap = {};
                typeObj.items   = [];
                for (var i = 0; i < data.items.length; i++) {
                    typeObj.itemMap[data.items[i]] = i;
                    typeObj.items.push(data.items[i]);
                }
            }
            else if (data.type == "struct") {
                if (!data.fields) { error("Missing 'fields' field in data type " + name); }
                typeObj.fields   = [];
                typeObj.fieldMap = {};
                // Loop over all the fields in the type
                for (var i = 0; i < data.fields.length; i++) {
                    var field = data.fields[i];
                    if (!field.name) { error("Missing name of field in structure " + name); }
                    var subType = {typeObj: this._learnType(field), name: field.name};
                    typeObj.fieldMap[field.name] = subType;
                    typeObj.fields.push(subType);
                }
            }
            else if (data.type == "array") {
                if (!data.entryType) { error("Missing 'entryType' field in data type " + name); }
                typeObj.entryType = this._learnType(data.entryType);
            }
            else {
                typeObj = this.types[data.type].typeObj;
            }

            return typeObj;

        };

        this._packInt = function(data, typeObj) {
            var isNeg = 0;
            if (data < 0) {
                isNeg = 1;
                data *= -1;
            }
            var valArr = valToUintArr(data);
            return this._packTlv(isNeg ? this.types["neg-int"].typeObj : typeObj,
                                 valArr);
        };

        this._packFloat = function(data) {
            var floatBuf = new ArrayBuffer(8);
            var floatArr = new Float64Array(floatBuf);
            floatArr[0] = data;
            return this._packTlvBufs(this.types["float"].typeObj, [floatBuf], 8);
        };

        this._packString = function(data, type) {
            var charArr = stringToUintArr(data.toString());
            return this._packTlv(type, charArr);
        };

        this._packEnum = function(data, type) {
            var buf, bufArr;
            if (typeof(type.itemMap[data]) == "undefined") {
                error("Unknown enum value: " + data);
            }
            var val = type.itemMap[data];
            if (val > 127) {
                buf = new ArrayBuffer(3);
                bufArr = new Uint8Array(buf);
                bufArr[0] = this.types[type.name].typeCode;
                bufArr[1] = 1;
                bufArr[2] = val;
            }
            else {
                var valArr = valToUintArr(val);
                buf = new ArrayBuffer(2 + valArr.length);
                bufArr = new Uint8Array(buf);
                
                bufArr[0] = this.types[type.name].typeCode;
                bufArr[1] = valArr.length;
                bufArr[2] = val;

            }
            return buf;
        };

        this._packStruct = function(data, type) {
            var entries = [];
            var length = 0;
            for (var i = 0; i < type.fields.length; i++) {
                var fieldType = type.fields[i];
                var entry;
                if (typeof(data[fieldType.name]) == "undefined") {
                    entry = this._packTlv(fieldType.typeObj, []);
                }
                else {
                    entry = this.packFuncs[fieldType.typeObj.type].call(this, data[fieldType.name], fieldType.typeObj);
                }
                entries.push(entry);
                length += entry.byteLength;
                // console.log("pack struct field: ", fieldType.name, entry.toArray());
            }
            return this._packTlvBufs(type, entries, length);
        };

        this._packArray = function(data, type) {
            var entries = [];
            var length  = 0;
            for (var i = 0; i < data.length; i++) {
                var entry = this.packFuncs[type.entryType.type].call(this, data[i], type.entryType);
                length += entry.byteLength;
                entries.push(entry);
            }
            return this._packTlvBufs(type, entries, length);
        };

        this._packTlv = function(type, uintArr) {

            var bufInfo = this._prepareBuffer(type, uintArr.length);

            var offset = bufInfo[2];
            var bufArr = bufInfo[1];
            var buf    = bufInfo[0];

            // Copy the array into the buffer
            for (var i = 0; i < uintArr.length; i++) {
                bufArr[i+offset] = uintArr[i];
            }

            return buf;
        };

        this._packTlvBufs = function(type, bufArr, byteLength) {

            var bufInfo = this._prepareBuffer(type, byteLength);

            var offset = bufInfo[2];
            var dstArr = bufInfo[1];
            var buf    = bufInfo[0];

            // Stuff the buffers into the container
            for (var i = 0; i < bufArr.length; i++) {
                dstArr.set(new Uint8Array(bufArr[i]), offset);
                offset += bufArr[i].byteLength;
            }

            return buf;

        };

        this._prepareBuffer = function(typeObj, byteLength) {

            // Encode the type
            var typeVal = this.types[typeObj.name] ? 
                this.types[typeObj.name].typeCode :
                this.types[typeObj.type].typeCode;
            var typeLen;
            var typeArr;
            if (typeVal > 127) {
                var typeArr = valToUintArr(typeVal);
                typeLen = typeArr.length;
            }
            else {
                typeLen = 1;
            }
            
            // Encode the length
            var lenArr = valToUintArr(byteLength);
            var lenLen;
            if (byteLength > 127) {
                var lenArr = valToUintArr(byteLength);
                lenLen = lenArr.length;
            }
            else {
                lenLen = 1;
            }

            // Create the buffer to hold the data
            var buf    = new ArrayBuffer(byteLength + lenLen + typeLen);
            var bufArr = new Uint8Array(buf);

            // Put the type in
            if (typeLen == 1) {
                bufArr[0] = typeVal;
            }
            else {
                for (var i = 0; i < typeArr.length; i++) {
                    bufArr[i] = typeArr[i];
                }
            }

            // Put the length in
            if (lenLen == 1) {
                bufArr[typeLen] = byteLength;
            }
            else {
                for (var i = 0; i < lenArr.length; i++) {
                    bufArr[i+typeLen] = lenArr[i];
                }
            }

            return [buf, bufArr, typeLen + lenLen];
            
        }


        this._unpackInt = function(uintArr) {
            return uintArrToVal(uintArr);
        };

        this._unpackNegInt = function(uintArr) {
            return -1*uintArrToVal(uintArr);
        };

        this._unpackFloat = function(data) {
            var buf      = new ArrayBuffer(8);
            var byteArr  = new Uint8Array(buf);
            byteArr.set(data);
            var floatArr = new Float64Array(buf);
            return floatArr[0];
        };

        this._unpackString = function(uintArr) {
            return uintArrToString(uintArr);
        };

        this._unpackEnum = function(data, type) {
            var val = uintArrToVal(data);
            var enumStr = type.items[val];
            if (!enumStr) {
                error("Unknown enum value " + val + " for " + type.name);
            }
            return enumStr;
        };

        this._unpackStruct = function(data, type) {
            // Walk through the fields - each should
            // be in the packed data
            var obj = {};
            for (var i = 0; i < type.fields.length; i++) {
                var field = type.fields[i];
                var res = this._unpackTlv(data, field.typeObj);
                if (typeof(res[0]) != "undefined") {
                    obj[field.name] = res[0];
                }
                data = res[1];
            }

            return obj;
            
        };

        this._unpackArray = function(data, typeObj) {
            var entries = [];
            
            var sanity = 1000000000;
            while (data.length > 0 && sanity--) {
                var res = this._unpackTlv(data, typeObj.entryType);
                entries.push(res[0]);
                data = res[1];
            }
            return entries;
        };

        this._unpackTlv = function(uintArr, expectedType) {

            var res = uintArrToValArr(uintArr, 2, true);

            var typeCode = res[0][0];
            var len      = res[0][1];
            var offset   = res[1];

            // console.log("Type: ", typeCode, "Len:", len, "offset", offset);
            if (!len) {
                return [undefined, uintArr.slice(offset)];
            }

            var typeObj = expectedType ? expectedType : this.typeArr[typeCode].typeObj;

            if (!typeObj) {
                error("Failed to unpack data. Unknown type code: " + typeCode);
            }

            var unpackFunc = this.unpackFuncs[typeObj.type];
            if (!unpackFunc) {
                error("Don't know how to unpack " + typeObj.type);
            }

            var res = unpackFunc.call(this, uintArr.slice(offset, offset + len), typeObj);
            return [res, uintArr.slice(offset+len)];
        };




        this.packFuncs = {
            int:     this._packInt,
            float:   this._packFloat,
            string:  this._packString,
            enum:    this._packEnum,
            struct:  this._packStruct,
            array:   this._packArray
        };

        this.unpackFuncs = {
            int:       this._unpackInt,
            'neg-int': this._unpackNegInt,
            float:     this._unpackFloat,
            string:    this._unpackString,
            enum:      this._unpackEnum,
            struct:    this._unpackStruct,
            array:     this._unpackArray
        };

        this._storeType("int",     {type: "int"});     // typeCode = 0
        this._storeType("neg-int", {type: "neg-int"}); // typeCode = 1
        this._storeType("string",  {type: "string"});  // typeCode = 2
        this._storeType("float",   {type: "float"});   // typeCode = 3
        this._storeType("enum",    {type: "enum"});    // typeCode = 4
        this._storeType("array",   {type: "array"});   // typeCode = 5
        this._storeType("struct",  {type: "struct"});  // typeCode = 6

    };

    // Helper routines
    function error(msg) {
        throw msg;
    }

    function valToUintArr(val) {
        var uintArr = [];
        while (1) {
            if (val > 127) {
                uintArr.push((val & 0x7f) | 0x80);
                if (val > 0x7fffffff) {
                    val = Math.abs(val/128);
                }
                else {
                    val >>= 7;
                }
            }
            else {
                uintArr.push(val);
                break;
            }
        }
        return uintArr;
    }

    function valArrToUintArr(valArr) {
        var uintArr = [];
        for(var i = 0; i < valArr.length; i++) {
            var val = valArr[i];
            while (1) {
                if (val > 127) {
                    uintArr.push((val & 0x7f) | 0x80);
                    if (val > 0x7fffffff) {
                        val = Math.abs(val/128);
                    }
                    else {
                        val >>= 7;
                    }
                }
                else {
                    uintArr.push(val);
                    break;
                }
            }
        }
        return uintArr;
    }

    function stringToUintArr(string) {
        var charArr = [];
        for (var i = 0; i < string.length; i++) {
            charArr.push(string.charCodeAt(i));
        }
        return valArrToUintArr(charArr);
    }

    function uintArrToString(uintArr) {
        var charArr = uintArrToValArr(uintArr);
        var string = "";
        for (var i = 0; i < charArr.length; i++) {
            string += String.fromCharCode(charArr[i]);
        }
        return string;
    }


    function uintArrToVal(uintArr) {
        var val = 0;
        var i = 0;
        var len = uintArr.length;
        while (i < len) {
            val += i ? (uintArr[i] & 0x7f) * (1 << (7*i)) : (uintArr[i] & 0x7f);
            if (uintArr[i] < 128) {
                break;
            }
            i++;
        }
        return val;
    }

    function uintArrToValArr(uintArr, limit, returnConsumed) {
        var valArr = [];
        var val    = 0;
        var i = 0, j = 0;
        var len = uintArr.length;
        while (i < len) {
            val += i ? (uintArr[i] & 0x7f) * (1 << (7*j)) : (uintArr[i] & 0x7f);
            j++;
            if (uintArr[i] < 128) {
                valArr.push(val);
                if (limit) {
                    limit--;
                    if (limit == 0) {
                        break;
                    }
                }
                val = 0;
                j = 0;
            }
            i++;
        }
        if (returnConsumed) {
            return [valArr, i+1];
        }
        return valArr;
    }




    ctx.Packer = packer;

})(this);


ArrayBuffer.prototype.toArray = function() {
    var arr = new Uint8Array(this);
    var res = [];
    for(var i = 0; i < this.byteLength; i++) {
        res.push(arr[i]);
    }
    return res;
}