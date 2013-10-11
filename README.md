packer.js
=========

A javascript library that does binary serialization/deserialization. 

The purpose of the library is for cases where the is communication between two parties
and every byte counts, but compression is not readily available or undesirable.

The libary works by having the application create a schema by way of 'typedefs'. The
library will use the schema to TLV encode JS objects into a minimal form. On the 
receiving end, it will use the schema again to restore the binary data into a normal
JS object. NOTE that it is essential that the encoding and decoding are both performed
with the same schema.

Synopsys
--------

First define some data types. BE AWARE that the library assigns numerical values to
each data type that it uses in serialization. The order of definition of the types
makes a difference.

   var packer = new Packer();

   packer.typedef({name: "testStruct", 
                   type: "struct",
                   fields: [
                       {name:  "one",   type:  "int"},
                       {name:  "two",   type:  "string"},
                       {name:  "three", type:  "test"},
                       {name:  "float", type:  "float"},
                       {name:  "four",  type:  "struct",
                        fields: [
                            {name: "subone", type: "int"},
                            {name: "subtwo", type: "int"}
                        ]}
                   ]});

   packer.typedef({name: "myArray",
                   type: "array",
                   entryType: "int"});


After the types are defined, you can pack them with the pack command:

   var data = {
       one: 1,
       float: 2.21232,
       two: "test string",
       three: "another string",
       four: {subone: 33030303,
              subtwo: 43030303}
   };

   // This will return an ArrayBuffer with the structure encoded in it
   var packed = packer.pack("testStruct", data);

To unpack the data into a javascript object:

   // The packed data has sufficient info to unpack without specifying the data type
   var unpacked = packer.unpack(packed);


