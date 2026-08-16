import tempfile
import unittest
from pathlib import Path

import app as terracore


class CloudDashboardTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = terracore.DB_PATH
        terracore.DB_PATH = str(Path(self.temp_dir.name) / "test.db")
        terracore.init_db()
        terracore.app.config.update(TESTING=True)
        self.client = terracore.app.test_client()

        response = self.client.post(
            "/api/projects",
            json={
                "name": "Greenhouse Demo",
                "code": (
                    "cloud_send('temperature', 27.5)\n"
                    "cloud_send('soil_moisture', 54)\n"
                ),
            },
        )
        self.assertEqual(response.status_code, 201)
        self.project = response.get_json()

    def tearDown(self):
        terracore.DB_PATH = self.old_db_path
        self.temp_dir.cleanup()

    def provision_dashboard(self):
        response = self.client.post(
            f"/api/projects/{self.project['id']}/mock-upload",
            json={"code": self.project["code"]},
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def test_upload_provisions_dashboard_and_infers_channels(self):
        dashboard = self.provision_dashboard()

        self.assertTrue(dashboard["mock"])
        self.assertFalse(dashboard["firmware_configured"])
        self.assertEqual(dashboard["network_mode"], "local-simulator")
        self.assertIn("mock_device_token", dashboard)
        self.assertNotIn("device_token", dashboard)
        self.assertTrue(dashboard["dashboard_url"].startswith("/dashboard/"))
        self.assertGreater(dashboard["firmware_bytes"], 0)
        self.assertEqual(
            [channel["key"] for channel in dashboard["channels"]],
            ["temperature", "soil_moisture"],
        )

        project_response = self.client.get(f"/api/projects/{self.project['id']}")
        self.assertEqual(
            project_response.get_json()["dashboard"]["token"], dashboard["token"]
        )

        detail_response = self.client.get(dashboard["dashboard_url"].replace("/dashboard/", "/api/dashboards/"))
        self.assertEqual(detail_response.status_code, 200)
        detail = detail_response.get_json()
        self.assertEqual(len(detail["history"]), 72)
        self.assertEqual(detail["packet_count"], 72)
        self.assertIn("temperature", detail["latest"])

    def test_upload_again_reuses_dashboard_url(self):
        first = self.provision_dashboard()
        second_response = self.client.post(
            f"/api/projects/{self.project['id']}/mock-upload",
            json={"code": "print('no cloud block')"},
        )
        second = second_response.get_json()

        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(second["token"], first["token"])
        self.assertEqual(
            [channel["key"] for channel in second["channels"]],
            ["temperature", "humidity", "light"],
        )

    def test_device_ingest_and_cloud_to_device_command(self):
        dashboard = self.provision_dashboard()

        ingest = self.client.post(
            "/api/cloud/ingest",
            json={
                "token": dashboard["mock_device_token"],
                "key": "temperature",
                "value": 31.5,
            },
        )
        self.assertEqual(ingest.status_code, 202)

        command = self.client.post(
            f"/api/dashboards/{dashboard['token']}/commands",
            json={"key": "led", "value": True},
        )
        self.assertEqual(command.status_code, 202)
        self.assertEqual(command.get_json()["status"], "queued")

        poll = self.client.get(
            f"/api/cloud/devices/{dashboard['mock_device_token']}/commands"
        )
        self.assertEqual(poll.status_code, 200)
        self.assertEqual(poll.get_json()[0]["key"], "led")

        detail = self.client.get(f"/api/dashboards/{dashboard['token']}").get_json()
        self.assertEqual(detail["latest"]["temperature"]["value"], 31.5)
        self.assertEqual(detail["commands"][0]["status"], "delivered")

    def test_invalid_device_data_is_rejected(self):
        dashboard = self.provision_dashboard()
        bad_token = self.client.post(
            "/api/cloud/ingest",
            json={"token": "wrong", "key": "temperature", "value": 20},
        )
        bad_channel = self.client.post(
            "/api/cloud/ingest",
            json={
                "token": dashboard["mock_device_token"],
                "key": "unknown",
                "value": 20,
            },
        )
        bad_value = self.client.post(
            "/api/cloud/ingest",
            json={
                "token": dashboard["mock_device_token"],
                "key": "temperature",
                "value": "not-a-number",
            },
        )

        self.assertEqual(bad_token.status_code, 401)
        self.assertEqual(bad_channel.status_code, 400)
        self.assertEqual(bad_value.status_code, 400)

    def test_deleting_project_removes_dashboard(self):
        dashboard = self.provision_dashboard()
        self.assertEqual(
            self.client.delete(f"/api/projects/{self.project['id']}").status_code,
            200,
        )
        self.assertEqual(
            self.client.get(f"/api/dashboards/{dashboard['token']}").status_code,
            404,
        )


if __name__ == "__main__":
    unittest.main()
