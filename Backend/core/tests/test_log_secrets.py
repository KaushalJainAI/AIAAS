"""
Credentials that travel in a URL's query string never reach a log line.

Some API cards send their key as `?key=...` (Trello), `?appid=...`
(OpenWeather). httpx logs each request URL at INFO, and `logging` interpolates
the URL from `record.args` after the filter has seen only the message, so the
filter must scrub arguments as well as the message. The httpx loggers are also
held at WARNING, so the INFO line is not produced at all.
"""
import logging
from collections import OrderedDict

import httpx
from django.test import SimpleTestCase

from core.safety.security import SensitiveDataFilter, redact_url_query

SECRET_KEY = 'trello-key-0123456789abcdef'
SECRET_TOKEN = 'trello-token-fedcba9876543210'


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


class RedactUrlQueryTests(SimpleTestCase):
    def test_secret_named_parameters_are_blanked(self):
        out = redact_url_query(
            'https://api.trello.com/1/boards?key=abc&token=xyz&id=7'
            '&appid=ow123&api_key=k1&access_token=t1&client_secret=s1&sig=g1')
        for value in ('abc', 'xyz', 'ow123', 'k1', 't1', 's1', 'g1'):
            self.assertNotIn(f'={value}', out)
        self.assertIn('id=7', out)
        self.assertEqual(out.count('***REDACTED***'), 7)

    def test_ordinary_parameters_and_similar_names_are_kept(self):
        url = 'https://example.com/search?q=hello&limit=5&monkey=banana&page=2'
        self.assertEqual(redact_url_query(url), url)


class SensitiveDataFilterTests(SimpleTestCase):
    def setUp(self):
        self.logger = logging.getLogger('core.tests.log_secrets')
        self.logger.setLevel(logging.DEBUG)
        self.logger.propagate = False
        self.capture = _Capture()
        self.capture.addFilter(SensitiveDataFilter())
        self.logger.addHandler(self.capture)
        self.addCleanup(self.logger.removeHandler, self.capture)

    def test_a_url_argument_is_scrubbed_and_its_status_kept(self):
        # The shape httpx uses: the URL is an argument, not part of the message.
        url = httpx.URL(f'https://api.trello.com/1/boards?key={SECRET_KEY}&token={SECRET_TOKEN}')
        self.logger.info('HTTP Request: %s %s "%s %d %s"',
                         'GET', url, 'HTTP/1.1', 200, 'OK')
        line = self.capture.lines[-1]
        self.assertNotIn(SECRET_KEY, line)
        self.assertNotIn(SECRET_TOKEN, line)
        self.assertIn('"HTTP/1.1 200 OK"', line)
        self.assertIn('api.trello.com/1/boards', line)

    def test_a_string_argument_is_scrubbed(self):
        self.logger.warning('calling %s', f'https://api.openweathermap.org/x?appid={SECRET_KEY}')
        self.assertNotIn(SECRET_KEY, self.capture.lines[-1])

    def test_a_mapping_argument_is_scrubbed(self):
        self.logger.info('call to %(url)s', OrderedDict(
            url=f'https://api.example.com/v1?api_key={SECRET_KEY}'))
        self.assertNotIn(SECRET_KEY, self.capture.lines[-1])

    def test_the_message_is_still_scrubbed(self):
        self.logger.info(f'fetch https://api.example.com/v1?token={SECRET_TOKEN}')
        self.assertNotIn(SECRET_TOKEN, self.capture.lines[-1])

    def test_numbers_keep_their_type_for_format_codes(self):
        self.logger.info('status %d took %.2f', 404, 0.5)
        self.assertEqual(self.capture.lines[-1], 'status 404 took 0.50')


class HttpClientLoggingTests(SimpleTestCase):
    def test_httpx_and_httpcore_do_not_log_at_info(self):
        for name in ('httpx', 'httpcore'):
            with self.subTest(logger=name):
                self.assertFalse(logging.getLogger(name).isEnabledFor(logging.INFO))
