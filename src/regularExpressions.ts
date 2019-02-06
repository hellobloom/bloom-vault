interface IRegExps {
  [s: string]: RegExp
}

interface IRegEx {
  auth: {
    uuid: RegExp
    fingerprint: {
      hyphen: RegExp
      colon: RegExp
      chars: RegExp
    }
  }
  requestUtils: {
    basicAuth: RegExp
  }
}

const regularExpressions: IRegEx = {
  auth: {
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    fingerprint: {
      hyphen: new RegExp('-', 'g'),
      colon: new RegExp(':', 'g'),
      chars: new RegExp('^[a-fA-F0-9]{40}$'),
    },
  },
  requestUtils: {
    basicAuth: /^(?:Bearer) ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  },
}
export default regularExpressions
