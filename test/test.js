

(function ($, ctx, undefined) {

    // Deep comparison from SO - thanks
    Object.equals = function( x, y ) {
        if ( x === y ) return true;
        if ( ! ( x instanceof Object ) || ! ( y instanceof Object ) ) return false;
        if ( x.constructor !== y.constructor ) return false;
        for ( var p in x ) {
            if ( ! x.hasOwnProperty( p ) ) continue;
            if ( ! y.hasOwnProperty( p ) ) return false;
            if ( x[ p ] === y[ p ] ) continue;
            if ( typeof( x[ p ] ) !== "object" ) return false;
            if ( ! Object.equals( x[ p ],  y[ p ] ) ) return false;
        }
        for ( p in y ) {
            if ( y.hasOwnProperty( p ) && ! x.hasOwnProperty( p ) ) return false;
        }
        return true;
    };


    $(document).ready(function() {

        var testNum = 1;
        var packer = new Packer();

        // Define some types
        packer.typedef({name: "test", 
                        type: "string"});
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
        packer.typedef({name: "testEnum", 
                        type: "enum",
                        items: [
                            "OK",
                            "FAIL",
                            "ERROR"
                        ]});
        packer.typedef({name: "testStruct2", 
                        type: "struct",
                        fields: [
                            {name:  "one",   type:  "testStruct"},
                            {name:  "two",   type:  "testEnum"},
                            {name:  "array", type:  "array", entryType: "testStruct"},
                        ]});

        console.log(packer);


        // Run some tests

        doTest("Simple Enum", 
               "testEnum", 
               "ERROR");
               
        toPack = {
            one: 1,
            float: 2.21232,
            two: "test string",
            three: "another string",
            four: {subone: 33030303,
                   subtwo: 43030303}
        };

        doTest("Mixed Structure", 
               "testStruct", 
               toPack);

        toPack = {
            array: [{one: 3},{two: "test"},{three: "another test"},{float: 3.4}],
            one: {
                one: 1,
                two: "test string",
                three: "another string",
                four: {subone: 3,
                       subtwo: 4},
            },
            two: "FAIL"
        };

        doTest("Nested Structure", 
               "testStruct2", 
               toPack);



        // Test function
        function doTest(desc, type, data) {
            var packed   = packer.pack(type, data);
            var unpacked = packer.unpack(packed);
            if (Object.equals(data, unpacked)) {
                result = "PASS";
            }
            else {
                result = "FAIL";
            }
            $("table tr").last().parent().append($("<tr><td>" + testNum + "</td><td>" + desc + "</td><td>" + result + "</td><td>" + packed.byteLength + "</td><td>" + JSON.stringify(data).length + " </td></tr>"));
            testNum++;
        }


    });



})(jQuery, this);

